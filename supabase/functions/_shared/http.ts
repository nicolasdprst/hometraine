export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-worker-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Secret serveur manquant: ${name}`);
  return value;
}

export function publicKey(): string {
  return Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || env('SUPABASE_ANON_KEY');
}

export function serverKey(): string {
  return Deno.env.get('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
}
