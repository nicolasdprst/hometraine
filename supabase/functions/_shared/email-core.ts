const STRAVA_UPLOAD_URL = 'https://www.strava.com/upload/select';

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character] as string));
}

function xmlEscape(value: unknown): string {
  return escapeHtml(value);
}

function duration(seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours ? `${hours} h ${String(minutes).padStart(2, '0')} min` : `${minutes} min ${String(rest).padStart(2, '0')} s`;
}

function dateFr(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(value));
}

export function buildTcx(session: Record<string, any>, detailed: Record<string, any>): string {
  if (!Array.isArray(detailed.time) || detailed.time.length === 0) throw new Error('Séries temporelles TCX indisponibles');
  const start = new Date(session.started_at);
  if (Number.isNaN(start.getTime())) throw new Error('Date de séance invalide');
  const startIso = start.toISOString();
  let currentDistance = 0;
  let points = '';
  for (let index = 0; index < detailed.time.length; index += 1) {
    const elapsed = Number(detailed.time[index]) || 0;
    const previous = index > 0 ? (Number(detailed.time[index - 1]) || 0) : 0;
    const rawSpeed = detailed.speed && detailed.speed[index];
    const rawWatts = detailed.watts && detailed.watts[index];
    const speed = rawSpeed === null || rawSpeed === undefined || rawSpeed === '' ? NaN : Number(rawSpeed);
    const watts = rawWatts === null || rawWatts === undefined || rawWatts === '' ? NaN : Number(rawWatts);
    if (detailed.distance && typeof detailed.distance[index] === 'number' && Number.isFinite(detailed.distance[index])) currentDistance = detailed.distance[index];
    else if (Number.isFinite(speed)) currentDistance += (speed / 3.6) * Math.max(0, elapsed - previous);
    const recorded = detailed.timestamps && detailed.timestamps[index];
    const pointDate = recorded ? new Date(recorded) : new Date(start.getTime() + elapsed * 1000);
    if (Number.isNaN(pointDate.getTime())) throw new Error('Horodatage TCX invalide');
    const powerXml = Number.isFinite(watts) ? `\n          <Watts>${Math.round(watts)}</Watts>` : '';
    const speedXml = Number.isFinite(speed) ? `\n          <Speed>${(speed / 3.6).toFixed(2)}</Speed>` : '';
    const extensions = powerXml || speedXml ? `
      <Extensions>
        <TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">${powerXml}${speedXml}
        </TPX>
      </Extensions>` : '';
    points += `
    <Trackpoint>
      <Time>${xmlEscape(pointDate.toISOString())}</Time>
      <DistanceMeters>${currentDistance.toFixed(2)}</DistanceMeters>${extensions}
    </Trackpoint>`;
  }
  const totalSeconds = Number(session.duration_seconds) || detailed.time.length;
  const totalDistance = Number(session.distance_meters) || currentDistance;
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2" xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Activities>
    <Activity Sport="Biking">
      <Id>${startIso}</Id>
      <Lap StartTime="${startIso}">
        <TotalTimeSeconds>${totalSeconds}</TotalTimeSeconds>
        <DistanceMeters>${totalDistance.toFixed(2)}</DistanceMeters>
        <Calories>${Number(session.energy_kcal) || 0}</Calories>
        <Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod>
        <Track>${points}
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function processDelivery(admin: any, deliveryId: string): Promise<Record<string, any>> {
  const { data: claimed, error: claimError } = await admin.from('email_deliveries')
    .update({ status: 'processing', last_error: null })
    .eq('id', deliveryId)
    .in('status', ['queued', 'failed'])
    .select('*').maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) {
    const { data: existing } = await admin.from('email_deliveries').select('*').eq('id', deliveryId).single();
    return existing;
  }

  // Le worker applique lui aussi le quota : les fonctions clientes ne sont
  // donc pas le seul rempart contre un grand nombre de travaux automatiques.
  const { data: dailyJobs, error: quotaError } = await admin.from('email_deliveries').select('id')
    .eq('owner_id', claimed.owner_id).gte('created_at', new Date(Date.now() - 86400000).toISOString())
    .order('created_at', { ascending: true }).limit(30);
  if (quotaError) {
    await admin.from('email_deliveries').update({
      status: 'failed', last_error: quotaError.message, next_attempt_at: new Date(Date.now() + 60000).toISOString()
    }).eq('id', claimed.id);
    throw quotaError;
  }
  if (!(dailyJobs || []).some((job: any) => job.id === claimed.id)) {
    const { data: limited } = await admin.from('email_deliveries').update({
      status: 'failed', last_error: 'Quota quotidien atteint : 30 e-mails', next_attempt_at: null
    }).eq('id', claimed.id).select('*').single();
    return limited;
  }

  try {
    const [{ data: session, error: sessionError }, { data: series, error: seriesError }] = await Promise.all([
      admin.from('sessions').select('*').eq('id', claimed.session_id).eq('owner_id', claimed.owner_id).single(),
      admin.from('session_data').select('data').eq('session_id', claimed.session_id).eq('owner_id', claimed.owner_id).single()
    ]);
    if (sessionError || !session) throw sessionError || new Error('Séance introuvable');
    if (seriesError || !series?.data) throw seriesError || new Error('Mesures détaillées introuvables');

    const tcx = buildTcx(session, series.data);
    const date = dateFr(session.started_at);
    const workout = session.workout_name || 'Roule Libre';
    const summary = [
      `Entraînement : ${workout}`,
      `Durée : ${duration(session.duration_seconds)}`,
      `Distance : ${(Number(session.distance_meters || 0) / 1000).toFixed(2)} km`,
      `Puissance moyenne : ${Math.round(Number(session.avg_power_watts) || 0)} W`,
      `Puissance maximale : ${Math.round(Number(session.max_power_watts) || 0)} W`,
      `Énergie dépensée : ${Math.round(Number(session.total_work_kj) || 0)} kJ`
    ];
    const text = `Bonjour,\n\nTa séance de home trainer du ${date} a bien été enregistrée.\n\nVoici ton récapitulatif :\n\n- ${summary.join('\n- ')}\n\nRetrouve ton fichier d’activité TCX en pièce jointe.\n\nPour ajouter cette séance à Strava :\n1. Télécharge la pièce jointe.\n2. Ouvre ${STRAVA_UPLOAD_URL}\n3. Sélectionne le fichier TCX téléchargé.\n4. Valide l’import.\n\nBonne séance et à bientôt !\n\nL’équipe HomeTraine`;
    const rows = summary.map(line => `<li style="margin:6px 0">${escapeHtml(line)}</li>`).join('');
    const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:600px;margin:auto;padding:24px"><div style="background:#fff;border-radius:12px;padding:24px"><h1 style="font-size:22px">Ta séance est prête !</h1><p>Bonjour,</p><p>Ta séance de home trainer du ${escapeHtml(date)} a bien été enregistrée.</p><ul>${rows}</ul><p>Retrouve ton véritable fichier d’activité TCX en pièce jointe.</p><a href="${STRAVA_UPLOAD_URL}" style="display:inline-block;background:#fc4c02;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">Importer sur Strava</a><p style="margin-top:22px">Bonne séance et à bientôt !<br>L’équipe HomeTraine</p></div></div></body></html>`;
    const filename = `HomeTraine_${session.started_at.replace(/[:.]/g, '-')}.tcx`;
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const resendFrom = Deno.env.get('RESEND_FROM');
    if (!resendApiKey || !resendFrom) throw new Error('Configuration Resend incomplète');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': claimed.idempotency_key
      },
      body: JSON.stringify({
        from: resendFrom, to: [claimed.recipient],
        subject: `HomeTraine — Ta séance du ${date} est prête !`, html, text,
        attachments: [{ filename, content: base64Utf8(tcx), content_type: 'application/vnd.garmin.tcx+xml' }]
      })
    });
    const provider = await response.json().catch(() => ({}));
    if (!response.ok || !provider.id) throw new Error(provider.message || `Resend HTTP ${response.status}`);
    const { data: accepted, error: updateError } = await admin.from('email_deliveries').update({
      status: 'accepted', provider_id: provider.id, provider_status: 'accepted',
      attempt_count: claimed.attempt_count + 1, accepted_at: new Date().toISOString(), next_attempt_at: null
    }).eq('id', claimed.id).select('*').single();
    if (updateError) throw updateError;
    return accepted;
  } catch (error) {
    const attempts = claimed.attempt_count + 1;
    const delaySeconds = Math.min(3600, Math.pow(2, Math.min(attempts, 10)) * 30);
    await admin.from('email_deliveries').update({
      status: 'failed', attempt_count: attempts, last_error: String(error instanceof Error ? error.message : error).slice(0, 1000),
      next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString()
    }).eq('id', claimed.id);
    throw error;
  }
}
