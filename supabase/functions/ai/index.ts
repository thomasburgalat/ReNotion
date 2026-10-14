// Proxy vers l'API Groq (compatible OpenAI), réservé aux membres d'un espace. Réponse en streaming SSE.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-model',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const GROQ = 'https://api.groq.com/openai/v1';
const PREFERRED = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
let resolvedModel: string | null = null;

async function pickModel(key: string): Promise<string> {
  const res = await fetch(`${GROQ}/models`, { headers: { Authorization: `Bearer ${key}` } });
  const ids: string[] = res.ok ? ((await res.json()).data || []).map((m: { id: string }) => m.id) : [];
  return PREFERRED.find((m) => ids.includes(m)) || ids.find((id) => !/whisper|tts|guard|embed/i.test(id)) || PREFERRED[0];
}

function callGroq(key: string, model: string, messages: unknown[], temperature: number) {
  return fetch(`${GROQ}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature, max_tokens: 4096, stream: true }),
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

  const key = Deno.env.get('GROQ_API_KEY');
  if (!key) return json({ error: 'La clé GROQ_API_KEY n’est pas configurée sur le serveur' }, 503);

  let body: { messages?: { role: string; content: string }[]; temperature?: number };
  try { body = await req.json(); } catch { return json({ error: 'Requête invalide' }, 400); }
  const messages = (body.messages || [])
    .filter((m) => ['system', 'user', 'assistant'].includes(m?.role) && typeof m.content === 'string')
    .slice(-20);
  const size = messages.reduce((n, m) => n + m.content.length, 0);
  if (!messages.length || size > 60000) return json({ error: 'Contenu vide ou trop long' }, 400);
  const temperature = Math.min(1.5, Math.max(0, Number(body.temperature ?? 0.6)));

  let model = Deno.env.get('GROQ_MODEL') || resolvedModel || PREFERRED[0];
  let res = await callGroq(key, model, messages, temperature);
  if (!res.ok && (res.status === 404 || res.status === 400)) {
    const err = await res.text();
    if (/model/i.test(err)) {
      model = resolvedModel = await pickModel(key);
      res = await callGroq(key, model, messages, temperature);
    } else return json({ error: 'Erreur Groq : ' + err.slice(0, 300) }, 502);
  }
  if (!res.ok || !res.body) {
    const err = await res.text();
    const msg = res.status === 429 ? 'Limite Groq atteinte, réessaie dans un instant' : 'Erreur Groq : ' + err.slice(0, 300);
    return json({ error: msg }, res.status === 429 ? 429 : 502);
  }
  resolvedModel = model;
  return new Response(res.body, {
    headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Model': model },
  });
});
