// Proxy IA réservé aux membres d'un espace, en streaming SSE (format OpenAI).
// Moteurs : « rapide » (Groq), « mistral » (Mistral), « reflexion » (Magistral, modèle de raisonnement de Mistral ;
// à défaut, gpt-oss sur Groq avec un effort de raisonnement élevé).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-model, x-engine, x-fallback',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Provider = { name: string; base: string; key?: string; preferred: string[]; envModel?: string };
const GROQ: Provider = {
  name: 'groq', base: 'https://api.groq.com/openai/v1', key: Deno.env.get('GROQ_API_KEY'),
  preferred: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'], envModel: Deno.env.get('GROQ_MODEL'),
};
const MISTRAL: Provider = {
  name: 'mistral', base: 'https://api.mistral.ai/v1', key: Deno.env.get('MISTRAL_API_KEY'),
  preferred: ['mistral-medium-latest', 'mistral-large-latest', 'mistral-small-latest'], envModel: Deno.env.get('MISTRAL_MODEL'),
};
const MAGISTRAL: Provider = {
  name: 'mistral', base: 'https://api.mistral.ai/v1', key: Deno.env.get('MISTRAL_API_KEY'),
  preferred: ['magistral-medium-latest', 'magistral-small-latest'], envModel: Deno.env.get('MISTRAL_REASONING_MODEL'),
};

const resolved = new Map<string, string>();

async function pickModel(p: Provider): Promise<string> {
  const res = await fetch(`${p.base}/models`, { headers: { Authorization: `Bearer ${p.key}` } });
  const ids: string[] = res.ok ? ((await res.json()).data || []).map((m: { id: string }) => m.id) : [];
  return p.preferred.find((m) => ids.includes(m)) || ids.find((id) => !/whisper|tts|guard|embed|ocr|moderation/i.test(id)) || p.preferred[0];
}

function call(p: Provider, model: string, messages: unknown[], temperature: number, think: boolean) {
  const body: Record<string, unknown> = { model, messages, temperature, stream: true, max_tokens: think ? 12000 : 4096 };
  if (think && p.name === 'groq' && model.includes('gpt-oss')) body.reasoning_effort = 'high';
  return fetch(`${p.base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await admin.auth.getUser(jwt);
  if (!auth?.user) return json({ error: 'Non connecté' }, 401);
  const { count } = await admin.from('members').select('user_id', { count: 'exact', head: true }).eq('user_id', auth.user.id);
  if (!count) return json({ error: 'Réservé aux membres' }, 403);

  let body: { messages?: { role: string; content: string }[]; temperature?: number; engine?: string };
  try { body = await req.json(); } catch { return json({ error: 'Requête invalide' }, 400); }
  const messages = (body.messages || [])
    .filter((m) => ['system', 'user', 'assistant'].includes(m?.role) && typeof m.content === 'string')
    .slice(-20);
  const size = messages.reduce((n, m) => n + m.content.length, 0);
  if (!messages.length || size > 120000) return json({ error: 'Contenu vide ou trop long' }, 400);

  const engine = ['mistral', 'reflexion'].includes(body.engine || '') ? body.engine! : 'rapide';
  const think = engine === 'reflexion';
  let provider = engine === 'mistral' ? MISTRAL : think ? MAGISTRAL : GROQ;
  if (!provider.key && engine === 'mistral') return json({ error: 'La clé MISTRAL_API_KEY n’est pas configurée sur le serveur' }, 503);
  if (!provider.key && think) provider = GROQ; // réflexion sans Mistral : gpt-oss en effort élevé
  if (!provider.key) return json({ error: 'La clé GROQ_API_KEY n’est pas configurée sur le serveur' }, 503);

  const temperature = Math.min(1.5, Math.max(0, Number(body.temperature ?? (think ? 0.7 : 0.6))));
  const cacheKey = provider.base + provider.preferred[0];
  let model = provider.envModel || resolved.get(cacheKey) || provider.preferred[0];
  let res = await call(provider, model, messages, temperature, think);
  if (!res.ok && [400, 404, 422].includes(res.status)) {
    const err = await res.text();
    if (/model|not found|invalid_model/i.test(err)) {
      model = await pickModel(provider);
      resolved.set(cacheKey, model);
      res = await call(provider, model, messages, temperature, think);
    } else return json({ error: `Erreur ${provider.name} : ` + err.slice(0, 300) }, 502);
  }
  // un nouvel essai si le fournisseur est saturé
  if (!res.ok && (res.status === 429 || res.status >= 500)) {
    await res.text();
    await new Promise((r) => setTimeout(r, 1500));
    res = await call(provider, model, messages, temperature, think);
  }
  let fallback = '';
  if (!res.ok && think && provider !== GROQ && GROQ.key) {
    // Magistral indisponible : réflexion poussée avec gpt-oss sur Groq
    const why = (await res.text()).slice(0, 200);
    console.error('magistral', res.status, why);
    fallback = `magistral-${res.status}`;
    provider = GROQ;
    model = GROQ.envModel || 'openai/gpt-oss-120b';
    res = await call(provider, model, messages, temperature, true);
  }
  if (!res.ok || !res.body) {
    const err = await res.text();
    console.error(provider.name, res.status, err.slice(0, 500));
    let detail = '';
    try { const j = JSON.parse(err); detail = j.message || j.error?.message || j.detail || ''; } catch { detail = err.slice(0, 200); }
    const msg = res.status === 429 ? `Limite atteinte chez ${provider.name}${detail ? ' (' + String(detail).slice(0, 160) + ')' : ''}, réessaie dans un instant`
      : res.status === 401 || res.status === 403 ? `Clé API ${provider.name} refusée${detail ? ' (' + String(detail).slice(0, 160) + ')' : ''}`
      : `Erreur ${provider.name} : ` + (detail || err).toString().slice(0, 300);
    return json({ error: msg }, res.status === 429 ? 429 : 502);
  }
  if (!fallback) resolved.set(cacheKey, model);
  return new Response(res.body, {
    headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Model': model, 'X-Engine': engine, ...(fallback ? { 'X-Fallback': fallback } : {}) },
  });
});
