import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { env, json, serverKey } from '../_shared/http.ts';
import { processDelivery } from '../_shared/email-core.ts';

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Méthode refusée' }, 405);
  if (request.headers.get('x-worker-secret') !== env('EMAIL_WORKER_SECRET')) return json({ error: 'Accès refusé' }, 401);
  const admin = createClient(env('SUPABASE_URL'), serverKey(), { auth: { persistSession: false } });
  // Une exécution interrompue ne doit pas bloquer définitivement un travail.
  await admin.from('email_deliveries').update({
    status: 'failed', last_error: 'Traitement interrompu, nouvelle tentative planifiée', next_attempt_at: new Date().toISOString()
  }).eq('status', 'processing').lt('updated_at', new Date(Date.now() - 600000).toISOString());
  const { data: jobs, error } = await admin.from('email_deliveries').select('id')
    .in('status', ['queued', 'failed']).lt('attempt_count', 8).lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true }).limit(10);
  if (error) return json({ error: error.message }, 500);
  const results = [];
  for (const job of jobs || []) {
    try { results.push({ id: job.id, status: (await processDelivery(admin, job.id)).status }); }
    catch (jobError) { results.push({ id: job.id, status: 'failed', error: jobError instanceof Error ? jobError.message : String(jobError) }); }
  }
  return json({ processed: results.length, results });
});
