import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { env, json, serverKey } from '../_shared/http.ts';

const statusByEvent: Record<string, string> = {
  'email.delivered': 'delivered', 'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed'
};

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Méthode refusée' }, 405);
  const raw = await request.text();
  try {
    const secret = env('RESEND_WEBHOOK_SECRET').replace(/^whsec_/, '');
    const payload: any = new Webhook(secret).verify(raw, {
      'webhook-id': request.headers.get('svix-id') || request.headers.get('webhook-id') || '',
      'webhook-timestamp': request.headers.get('svix-timestamp') || request.headers.get('webhook-timestamp') || '',
      'webhook-signature': request.headers.get('svix-signature') || request.headers.get('webhook-signature') || ''
    });
    const status = statusByEvent[payload.type];
    const providerId = payload.data?.email_id || payload.data?.id;
    if (!status || !providerId) return json({ received: true });
    const changes: Record<string, any> = { status, provider_status: payload.type };
    if (status === 'delivered') changes.delivered_at = new Date().toISOString();
    if (status === 'failed') changes.next_attempt_at = new Date(Date.now() + 300000).toISOString();
    if (status === 'delayed') changes.next_attempt_at = null;
    const admin = createClient(env('SUPABASE_URL'), serverKey(), { auth: { persistSession: false } });
    const { error } = await admin.from('email_deliveries').update(changes).eq('provider_id', providerId);
    if (error) throw error;
    return json({ received: true });
  } catch (error) {
    console.error(error);
    return json({ error: 'Signature webhook invalide' }, 400);
  }
});
