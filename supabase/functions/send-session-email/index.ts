import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { corsHeaders, env, json, publicKey, serverKey } from '../_shared/http.ts';
import { processDelivery } from '../_shared/email-core.ts';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Méthode refusée' }, 405);
  try {
    env('GOOGLE_SCRIPT_URL'); env('GOOGLE_SCRIPT_SECRET');
    const authorization = request.headers.get('Authorization') || '';
    if (!authorization.startsWith('Bearer ')) return json({ error: 'Authentification requise' }, 401);
    const userClient = createClient(env('SUPABASE_URL'), publicKey(), { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser(authorization.slice(7));
    if (authError || !user) return json({ error: 'Session invalide' }, 401);
    const body = await request.json();
    const sessionId = String(body.session_id || '');
    const recipient = String(body.recipient || '').trim().toLowerCase();
    const sendType = body.send_type === 'automatic' ? 'automatic' : 'manual';
    const requestId = String(body.request_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !EMAIL_PATTERN.test(recipient)) return json({ error: 'Requête ou adresse e-mail invalide' }, 400);
    if (!requestId || requestId.length > 180 || !/^[a-z0-9/_-]+$/i.test(requestId)) return json({ error: 'Clé de requête invalide' }, 400);

    const admin = createClient(env('SUPABASE_URL'), serverKey(), { auth: { persistSession: false } });
    const { data: session } = await admin.from('sessions').select('*').eq('id', sessionId).eq('owner_id', user.id).single();
    if (!session) return json({ error: 'Séance introuvable ou accès refusé' }, 404);
    const { data: profile } = await admin.from('profiles').select('id,email_address,email_auto_send').eq('id', session.profile_id).eq('owner_id', user.id).single();
    if (!profile) return json({ error: 'Profil introuvable ou accès refusé' }, 404);
    if (sendType === 'automatic' && (!session.email_auto_requested || session.email_recipient_snapshot !== recipient)) {
      return json({ error: 'Envoi automatique non autorisé pour cette séance' }, 403);
    }

    const idempotencyKey = sendType === 'automatic'
      ? `auto/${user.id}/${profile.id}/${session.id}/tcx`
      : `manual/${user.id}/${profile.id}/${session.id}/${requestId}`.slice(0, 256);
    const { data: existing, error: existingError } = await admin.from('email_deliveries').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (existingError) throw existingError;
    if (existing && existing.status === 'sent') return json({ status: existing.status, delivery_id: existing.id });

    let delivery = existing;
    if (!delivery) {
      const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
      const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
      const [hourlyResult, dailyResult] = await Promise.all([
        admin.from('email_deliveries').select('id', { count: 'exact', head: true }).eq('owner_id', user.id).eq('send_type', 'manual').gte('created_at', oneHourAgo),
        admin.from('email_deliveries').select('id', { count: 'exact', head: true }).eq('owner_id', user.id).gte('created_at', oneDayAgo)
      ]);
      if (hourlyResult.error || dailyResult.error) throw hourlyResult.error || dailyResult.error;
      if (sendType === 'manual' && (hourlyResult.count || 0) >= 10) return json({ error: 'Limite atteinte : 10 envois manuels par heure' }, 429);
      if ((dailyResult.count || 0) >= 30) return json({ error: 'Quota quotidien atteint : 30 e-mails' }, 429);
      const { data, error } = await admin.from('email_deliveries').insert({
        owner_id: user.id, session_id: session.id, profile_id: profile.id, recipient,
        send_type: sendType, file_format: 'tcx', idempotency_key: idempotencyKey, status: 'pending'
      }).select('*').single();
      if (error) throw error;
      delivery = data;
    }
    const result = await processDelivery(admin, delivery.id);
    return json({ status: result.status, delivery_id: result.id, provider_id: result.provider_id });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Erreur serveur' }, 500);
  }
});
