// Inscription sans e-mail : pseudo + mot de passe + code d'invitation d'un espace.
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
const COLORS = ['#e03e3e', '#d9730d', '#dfab01', '#0f7b6c', '#0b6e99', '#6940a5', '#ad1a72', '#64473a'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

  let body: { code?: string; username?: string; password?: string; displayName?: string };
  try { body = await req.json(); } catch { return json({ error: 'Requête invalide' }, 400); }

  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const code = String(body.code || '').trim().toLowerCase();
  const displayName = String(body.displayName || body.username || '').trim().slice(0, 40);

  if (!/^[a-z0-9._-]{2,32}$/.test(username)) return json({ error: 'Pseudo : 2 à 32 caractères (lettres, chiffres, . _ -)' }, 400);
  if (password.length < 8) return json({ error: 'Mot de passe : 8 caractères minimum' }, 400);
  if (!/^[0-9a-f]{6,32}$/.test(code)) return json({ error: 'Code d’invitation invalide' }, 400);

  const { data: ws } = await admin.from('workspaces').select('id').eq('invite_code', code).maybeSingle();
  if (!ws) return json({ error: 'Code d’invitation invalide' }, 403);

  const { data: created, error } = await admin.auth.admin.createUser({
    email: `${username}@renotion.local`,
    password,
    email_confirm: true,
    user_metadata: { username, display_name: displayName },
  });
  if (error || !created.user) {
    const taken = /already|exists|registered/i.test(error?.message || '');
    return json({ error: taken ? 'Ce pseudo est déjà pris' : 'Inscription impossible', detail: error?.message }, taken ? 409 : 500);
  }

  const { count } = await admin.from('members').select('user_id', { count: 'exact', head: true }).eq('workspace_id', ws.id);
  const { error: mErr } = await admin.from('members').insert({
    workspace_id: ws.id,
    user_id: created.user.id,
    display_name: displayName || username,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    role: count ? 'member' : 'owner',
  });
  if (mErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: 'Inscription impossible', detail: mErr.message }, 500);
  }
  return json({ ok: true });
});
