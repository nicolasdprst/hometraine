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

function dictionaryKey(name: string): string | null {
  const raw = Deno.env.get(name);
  if (!raw) return null;
  try {
    const keys: Record<string, unknown> = JSON.parse(raw);
    const candidate = typeof keys.default === 'string'
      ? keys.default
      : Object.values(keys).find(value => typeof value === 'string');
    return typeof candidate === 'string' ? candidate : null;
  } catch (_error) {
    throw new Error(`Configuration Supabase invalide: ${name}`);
  }
}

export function publicKey(): string {
  return Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
    || dictionaryKey('SUPABASE_PUBLISHABLE_KEYS')
    || env('SUPABASE_ANON_KEY');
}

export function serverKey(): string {
  return Deno.env.get('SUPABASE_SECRET_KEY')
    || dictionaryKey('SUPABASE_SECRET_KEYS')
    || env('SUPABASE_SERVICE_ROLE_KEY');
}
