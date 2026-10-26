import { corsHeaders, env, json, publicKey, serverKey } from '../_shared/http.ts';

const SUPABASE_URL = env('SUPABASE_URL');
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
const ALLOWED_SUMMARY_KEYS = new Set(['profile_id', 'goal', 'ftp_known', 'indicators']);

function bearer(req: Request): string | null {
  const value = req.headers.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7) : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Méthode refusée' }, 405);
  try {
    const token = bearer(req);
    if (!token) return json({ error: 'Authentification requise' }, 401);
    const auth = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: publicKey(), Authorization: `Bearer ${token}` } });
    if (!auth.ok) return json({ error: 'Session invalide' }, 401);
    const user = await auth.json();
    const body = await req.json();
    const summary = body && body.summary;
    const candidates = body && body.candidate_workout_ids;
    if (!summary || Object.keys(summary).some(key => !ALLOWED_SUMMARY_KEYS.has(key)) || !Array.isArray(candidates) || candidates.length < 1 || candidates.length > 6) return json({ error: 'Requête invalide' }, 400);
    if (typeof summary.profile_id !== 'string' || candidates.some((id: unknown) => typeof id !== 'string' || id.length > 64)) return json({ error: 'Données invalides' }, 400);

    const adminHeaders = { apikey: serverKey(), Authorization: `Bearer ${serverKey()}`, 'Content-Type': 'application/json' };
    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(summary.profile_id)}&owner_id=eq.${encodeURIComponent(user.id)}&select=id`, { headers: adminHeaders });
    const profiles = await profileRes.json();
    if (!Array.isArray(profiles) || profiles.length !== 1) return json({ error: 'Profil inaccessible' }, 403);

    const since = new Date(Date.now() - 3600000).toISOString();
    const usageRes = await fetch(`${SUPABASE_URL}/rest/v1/ai_recommendation_usage?owner_id=eq.${encodeURIComponent(user.id)}&created_at=gte.${encodeURIComponent(since)}&select=id`, { headers: adminHeaders });
    const usage = await usageRes.json();
    if (Array.isArray(usage) && usage.length >= 10) return json({ error: 'Quota horaire atteint' }, 429);

    const prompt = `Explique brièvement un choix d'entraînement cycliste. Les calculs déterministes sont déjà validés. Classe uniquement les identifiants candidats et n'invente aucune mesure physiologique. Résumé agrégé: ${JSON.stringify(summary)}. Candidats: ${JSON.stringify(candidates)}.`;
    const gemini = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 300,
          responseMimeType: 'application/json',
          responseJsonSchema: {
            type: 'object', additionalProperties: false,
            properties: {
              explanation: { type: 'string', maxLength: 600 },
              workout_ids: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', enum: candidates } },
              tip: { type: 'string', maxLength: 240 }
            },
            required: ['explanation', 'workout_ids', 'tip']
          }
        }
      })
    });
    if (!gemini.ok) return json({ error: 'Service de conseil indisponible' }, 503);
    const raw = await gemini.json();
    const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = JSON.parse(text || 'null');
    if (!parsed || typeof parsed.explanation !== 'string' || parsed.explanation.length > 600 || !Array.isArray(parsed.workout_ids) || parsed.workout_ids.some((id: string) => !candidates.includes(id))) return json({ error: 'Réponse IA rejetée' }, 502);
    await fetch(`${SUPABASE_URL}/rest/v1/ai_recommendation_usage`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ owner_id: user.id }) });
    return json(parsed);
  } catch (error) {
    console.error(error);
    return json({ error: 'Conseil temporairement indisponible' }, 503);
  }
});
