// Serveur MCP de ReNotion (transport HTTP « streamable », réponses JSON).
// Authentification : jeton personnel « rn_… » dans l'URL (/functions/v1/mcp/<jeton>) ou en en-tête Authorization: Bearer.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const SERVER = { name: 'renotion', version: '1.0.0' };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version, accept',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'mcp-session-id',
};

/* ---------- Utilitaires ---------- */

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

class UserError extends Error {}

/* ---------- Markdown <-> blocs (même format que l'app) ---------- */

function inlineMd(s: string) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

type Block = { id: string; type: string; text: string; indent: number; props: Record<string, unknown> };

function parseLine(line: string): Block {
  const rules: [RegExp, string][] = [
    [/^#{3,6}\s+/, 'h3'], [/^##\s+/, 'h2'], [/^#\s+/, 'h1'], [/^\s*[-*+]\s+\[( |x|X)\]\s+/, 'todo'], [/^\s*\[( |x|X)?\]\s+/, 'todo'],
    [/^\s*[-*+•]\s+/, 'ul'], [/^\s*\d+[.)]\s+/, 'ol'], [/^>\s+/, 'quote'], [/^(-{3,}|\*{3,})\s*$/, 'divider'],
  ];
  const indent = Math.min(8, Math.floor(line.match(/^\s*/)![0].replace(/\t/g, '  ').length / 2));
  for (const [re, type] of rules) {
    const m = line.match(re);
    if (m) {
      const props: Record<string, unknown> = {};
      if (type === 'todo') props.checked = /x/i.test(m[1] || '');
      return { id: uid(), type, text: type === 'divider' ? '' : inlineMd(line.slice(m[0].length)), indent: ['ul', 'ol', 'todo'].includes(type) ? indent : 0, props };
    }
  }
  return { id: uid(), type: 'p', text: inlineMd(line.trim()), indent: 0, props: {} };
}

function splitRow(line: string) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; } else if (s[i] === '|') { out.push(cur); cur = ''; } else cur += s[i];
  }
  out.push(cur);
  return out.map((x) => x.trim());
}
const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

function tableBlock(lines: string[]): Block {
  const hasSep = lines.length > 1 && isSep(lines[1]);
  const rows = lines.filter((l, i) => !(hasSep && i === 1) && !isSep(l)).map((l) => splitRow(l).map((x) => inlineMd(x.replace(/<br\s*\/?>/gi, ' '))));
  const n = Math.max(1, ...rows.map((r) => r.length));
  rows.forEach((r) => { while (r.length < n) r.push(''); });
  return { id: uid(), type: 'table', text: '', indent: 0, props: { rows, headerRow: hasSep, headerCol: false } };
}

function mdToBlocks(md: string): Block[] {
  const out: Block[] = [];
  let code: Block | null = null;
  let tbl: string[] | null = null;
  for (const line of String(md || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!code && /^\s*\|.*\|\s*$/.test(line)) { (tbl = tbl || []).push(line); continue; }
    if (tbl) { out.push(tableBlock(tbl)); tbl = null; }
    if (/^\s*```/.test(line)) {
      if (code) { code = null; continue; }
      code = { id: uid(), type: 'code', text: '', indent: 0, props: { lang: line.trim().slice(3).trim() } };
      out.push(code);
      continue;
    }
    if (code) { code.text += (code.text ? '\n' : '') + line; continue; }
    if (!line.trim()) continue;
    out.push(parseLine(line));
  }
  if (tbl) out.push(tableBlock(tbl));
  return out;
}

function htmlToMd(html: string) {
  return unesc(String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<(s|strike)>([\s\S]*?)<\/\1>/gi, '~~$2~~')
    .replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<[^>]+>/g, ''));
}

type Row = { id: string; type: string; text: string; indent: number; props: Record<string, unknown> };
type PageRow = { id: string; title: string; icon: string; kind: string; parent_id: string | null };

function blocksToMd(blocks: Row[], titles: Record<string, string>) {
  const out: string[] = [];
  const counters: number[] = [];
  for (const b of blocks) {
    const ind = '  '.repeat(b.indent || 0);
    const t = b.type === 'code' ? b.text : htmlToMd(b.text);
    const p = b.props || {};
    counters.length = (b.indent || 0) + 1;
    switch (b.type) {
      case 'h1': out.push(`## ${t}`, ''); break;
      case 'h2': out.push(`### ${t}`, ''); break;
      case 'h3': out.push(`#### ${t}`, ''); break;
      case 'ul': case 'toggle': out.push(`${ind}- ${t}`); break;
      case 'ol': counters[b.indent || 0] = (counters[b.indent || 0] || 0) + 1; out.push(`${ind}${counters[b.indent || 0]}. ${t}`); break;
      case 'todo': out.push(`${ind}- [${p.checked ? 'x' : ' '}] ${t}`); break;
      case 'quote': out.push(`> ${t}`, ''); break;
      case 'callout': out.push(`> ${p.icon || '💡'} ${t}`, ''); break;
      case 'code': out.push('```' + (p.lang || ''), t, '```', ''); break;
      case 'divider': out.push('---', ''); break;
      case 'page': out.push(`${ind}📄 [${titles[p.pageId as string] || 'Sous-page'}] (page_id: ${p.pageId})`, ''); break;
      case 'table': {
        const rows = (p.rows as string[][]) || [];
        if (rows.length) {
          const cell = (h: string) => htmlToMd(h).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
          const line = (r: string[]) => '| ' + r.map(cell).join(' | ') + ' |';
          out.push(line(rows[0]), '| ' + rows[0].map(() => '---').join(' | ') + ' |', ...rows.slice(1).map(line), '');
        }
        break;
      }
      default: out.push(ind + t, '');
    }
    if (b.type !== 'ol') counters[b.indent || 0] = 0;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const plainOf = (b: Row) => b.type === 'table' ? ((b.props.rows as string[][]) || []).flat().map(htmlToMd).join(' · ') : htmlToMd(b.text);

/* ---------- Accès aux données ---------- */

type Ctx = { userId: string; workspaces: { id: string; name: string }[] };

async function authenticate(token: string): Promise<Ctx | null> {
  if (!/^rn_[0-9a-f]{48}$/.test(token)) return null;
  const { data: tok } = await db.from('mcp_tokens').select('id, user_id').eq('token_hash', await sha256(token)).maybeSingle();
  if (!tok) return null;
  db.from('mcp_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', tok.id).then(() => {});
  const { data: mem } = await db.from('members').select('workspace_id, workspaces(id, name)').eq('user_id', tok.user_id);
  const workspaces = (mem || []).map((m: any) => m.workspaces).filter(Boolean);
  return { userId: tok.user_id, workspaces };
}

function pickWorkspace(ctx: Ctx, ws?: string) {
  if (!ctx.workspaces.length) throw new UserError('Ce compte n’appartient à aucun espace.');
  if (!ws) {
    if (ctx.workspaces.length === 1) return ctx.workspaces[0];
    throw new UserError('Plusieurs espaces : précise « workspace » (id ou nom). Espaces : ' + ctx.workspaces.map((w) => `${w.name} (${w.id})`).join(', '));
  }
  const w = ctx.workspaces.find((x) => x.id === ws || x.name.toLowerCase() === ws.toLowerCase());
  if (!w) throw new UserError('Espace inconnu ou non accessible : ' + ws);
  return w;
}

async function getPage(ctx: Ctx, pageId: string) {
  const { data: p } = await db.from('pages').select('*').eq('id', pageId).maybeSingle();
  if (!p || !ctx.workspaces.some((w) => w.id === p.workspace_id)) throw new UserError('Page introuvable : ' + pageId);
  return p;
}

async function allPages(wsId: string) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('pages').select('id, parent_id, title, icon, kind, pos, trashed, updated_at').eq('workspace_id', wsId).order('pos').range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function pageBlocks(pageId: string): Promise<(Row & { pos: number })[]> {
  const { data, error } = await db.from('blocks').select('id, type, text, indent, props, pos').eq('page_id', pageId).order('pos');
  if (error) throw error;
  return data as any;
}

function isTrashed(p: any, byId: Map<string, any>) {
  for (let x = p; x; x = byId.get(x.parent_id)) if (x.trashed) return true;
  return false;
}

// Diffuse le changement aux membres connectés (même format que l'app)
async function broadcast(wsId: string, payload: unknown) {
  try {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ messages: [{ topic: 'ws:' + wsId, event: 'ops', payload, private: true }] }),
    });
  } catch (e) { console.error('broadcast', e); }
}

const pageRowOut = (p: any) => ({ id: p.id, parent_id: p.parent_id, title: p.title, icon: p.icon, cover: p.cover, pos: p.pos, trashed: p.trashed, trashed_at: p.trashed_at, kind: p.kind });
const blockRowOut = (b: any) => ({ id: b.id, page_id: b.page_id, pos: b.pos, type: b.type, text: b.text, indent: b.indent, props: b.props });

async function saveVersion(ctx: Ctx, page: any, blocks: any[]) {
  if (page.kind === 'folder') return;
  const data = {
    title: page.title, icon: page.icon, cover: page.cover,
    blocks: blocks.map((b) => ({ id: b.id, type: b.type, text: b.text, indent: b.indent, ...(b.props || {}) })),
  };
  await db.from('page_versions').insert({ page_id: page.id, workspace_id: page.workspace_id, created_by: ctx.userId, reason: 'Avant modification par l’assistant', data });
}

async function nextPos(wsId: string, parentId: string | null) {
  let q = db.from('pages').select('pos').eq('workspace_id', wsId).order('pos', { ascending: false }).limit(1);
  q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null);
  const { data } = await q;
  return data && data[0] ? data[0].pos + 1 : 0;
}

async function insertBlocks(ctx: Ctx, page: any, blocks: Block[], startPos: number) {
  const rows = blocks.map((b, i) => ({ id: b.id, page_id: page.id, workspace_id: page.workspace_id, pos: startPos + i, type: b.type, text: b.text, indent: b.indent, props: b.props, updated_by: ctx.userId }));
  if (rows.length) {
    const { error } = await db.from('blocks').insert(rows);
    if (error) throw error;
  }
  return rows;
}

async function touchPage(ctx: Ctx, pageId: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await db.from('pages').update({ updated_at: new Date().toISOString(), updated_by: ctx.userId, ...extra }).eq('id', pageId).select('*').single();
  if (error) throw error;
  return data;
}

/* ---------- Outils ---------- */

const WS_PARAM = { type: 'string', description: 'Id ou nom de l’espace. Facultatif si le compte n’a qu’un espace.' };

const TOOLS = [
  {
    name: 'list_workspaces',
    description: 'Liste les espaces ReNotion accessibles avec ce jeton.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_pages',
    description: 'Arborescence des pages et dossiers d’un espace (hors corbeille), avec leur id. Passe folder_id pour ne lister que le contenu d’un dossier ou d’une page.',
    inputSchema: { type: 'object', properties: { workspace: WS_PARAM, folder_id: { type: 'string', description: 'Id d’un dossier ou d’une page parente.' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'search',
    description: 'Recherche plein texte dans les titres et le contenu des pages. Renvoie les pages correspondantes avec un extrait.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, workspace: WS_PARAM, limit: { type: 'number', description: 'Maximum 50, défaut 15.' } }, required: ['query'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_page',
    description: 'Lit une page et renvoie son contenu en Markdown (tableaux compris). Pour un dossier, renvoie la liste de son contenu.',
    inputSchema: { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_page',
    description: 'Crée une page (contenu en Markdown : titres, listes, cases à cocher - [ ], citations, code, tableaux | a | b |) ou un dossier (kind = "folder").',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        markdown: { type: 'string', description: 'Contenu de la page en Markdown.' },
        parent_id: { type: 'string', description: 'Dossier ou page parente. Absent = à la racine.' },
        kind: { type: 'string', enum: ['page', 'folder'] },
        icon: { type: 'string', description: 'Un emoji.' },
        workspace: WS_PARAM,
      },
      required: ['title'],
    },
  },
  {
    name: 'append_to_page',
    description: 'Ajoute du contenu Markdown à la fin d’une page existante.',
    inputSchema: { type: 'object', properties: { page_id: { type: 'string' }, markdown: { type: 'string' } }, required: ['page_id', 'markdown'] },
  },
  {
    name: 'replace_page_content',
    description: 'Remplace tout le contenu d’une page par du Markdown. Une version de l’ancien contenu est sauvegardée dans l’historique.',
    inputSchema: { type: 'object', properties: { page_id: { type: 'string' }, markdown: { type: 'string' } }, required: ['page_id', 'markdown'] },
    annotations: { destructiveHint: true },
  },
  {
    name: 'update_page',
    description: 'Renomme une page ou un dossier, change son icône, le déplace (parent_id, ou null pour la racine) ou le met à la corbeille / le restaure (trashed).',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string' },
        title: { type: 'string' },
        icon: { type: 'string' },
        parent_id: { type: ['string', 'null'] },
        trashed: { type: 'boolean' },
      },
      required: ['page_id'],
    },
  },
];

async function callTool(ctx: Ctx, name: string, a: any): Promise<string> {
  switch (name) {
    case 'list_workspaces':
      return ctx.workspaces.map((w) => `- ${w.name} (id: ${w.id})`).join('\n') || 'Aucun espace.';

    case 'list_pages': {
      const w = pickWorkspace(ctx, a.workspace);
      const pages = await allPages(w.id);
      const byId = new Map(pages.map((p) => [p.id, p]));
      const live = pages.filter((p) => !isTrashed(p, byId));
      const kids = (pid: string | null) => live.filter((p) => (p.parent_id || null) === pid).sort((x, y) => x.pos - y.pos);
      const lines: string[] = [];
      const walk = (pid: string | null, depth: number) => kids(pid).forEach((p) => {
        lines.push(`${'  '.repeat(depth)}- ${p.kind === 'folder' ? '📁' : p.icon || '📄'} ${p.title || 'Sans titre'} (id: ${p.id}${p.kind === 'folder' ? ', dossier' : ''})`);
        walk(p.id, depth + 1);
      });
      if (a.folder_id) {
        const root = byId.get(a.folder_id);
        if (!root || isTrashed(root, byId)) throw new UserError('Dossier ou page introuvable : ' + a.folder_id);
        walk(a.folder_id, 0);
        return `Contenu de « ${root.title || 'Sans titre'} » :\n` + (lines.join('\n') || '(vide)');
      }
      walk(null, 0);
      return `Espace « ${w.name} » :\n` + (lines.join('\n') || '(aucune page)');
    }

    case 'search': {
      const w = pickWorkspace(ctx, a.workspace);
      const q = String(a.query || '').trim().toLowerCase();
      if (!q) throw new UserError('query est vide');
      const limit = Math.min(50, Math.max(1, Number(a.limit) || 15));
      const pages = await allPages(w.id);
      const byId = new Map(pages.map((p) => [p.id, p]));
      const live = new Map(pages.filter((p) => !isTrashed(p, byId)).map((p) => [p.id, p]));
      const hits = new Map<string, string>();
      for (const p of live.values()) if ((p.title || '').toLowerCase().includes(q)) hits.set(p.id, '(titre)');
      const pat = '%' + q.replace(/[%_\\]/g, (c) => '\\' + c) + '%';
      const [{ data: textHits }, { data: tables }] = await Promise.all([
        db.from('blocks').select('page_id, type, text, props').eq('workspace_id', w.id).ilike('text', pat).limit(1000),
        db.from('blocks').select('page_id, type, text, props').eq('workspace_id', w.id).eq('type', 'table').limit(1000),
      ]);
      for (const b of [...(textHits || []), ...(tables || [])] as any[]) {
        if (!live.has(b.page_id) || hits.has(b.page_id)) continue;
        const t = plainOf(b);
        const i = t.toLowerCase().indexOf(q);
        if (i >= 0) hits.set(b.page_id, (i > 40 ? '…' : '') + t.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, ' '));
      }
      const res = [...hits.entries()].slice(0, limit).map(([id, snip]) => `- ${live.get(id).title || 'Sans titre'} (id: ${id}) — ${snip}`);
      return res.length ? res.join('\n') : 'Aucun résultat pour « ' + a.query + ' ».';
    }

    case 'read_page': {
      const p = await getPage(ctx, a.page_id);
      if (p.kind === 'folder') {
        const { data } = await db.from('pages').select('id, title, kind, icon, trashed').eq('parent_id', p.id).order('pos');
        const items = (data || []).filter((x: any) => !x.trashed).map((x: any) => `- ${x.kind === 'folder' ? '📁' : x.icon || '📄'} ${x.title || 'Sans titre'} (id: ${x.id})`);
        return `# 📁 ${p.title || 'Sans titre'} (dossier)\n\n${items.join('\n') || '(vide)'}`;
      }
      const blocks = await pageBlocks(p.id);
      const subIds = blocks.filter((b) => b.type === 'page').map((b) => b.props.pageId as string);
      const titles: Record<string, string> = {};
      if (subIds.length) {
        const { data } = await db.from('pages').select('id, title').in('id', subIds);
        (data || []).forEach((x: any) => { titles[x.id] = x.title; });
      }
      return `# ${p.icon ? p.icon + ' ' : ''}${p.title || 'Sans titre'}\n(id: ${p.id}${p.trashed ? ', dans la corbeille' : ''}, modifiée le ${new Date(p.updated_at).toLocaleString('fr-FR')})\n\n${blocksToMd(blocks, titles) || '(page vide)'}`;
    }

    case 'create_page': {
      const w = pickWorkspace(ctx, a.workspace);
      const kind = a.kind === 'folder' ? 'folder' : 'page';
      let parent: string | null = a.parent_id || null;
      if (parent) {
        const pp = await getPage(ctx, parent);
        if (pp.workspace_id !== w.id) throw new UserError('Le parent est dans un autre espace.');
      }
      const id = uid();
      const row = { id, workspace_id: w.id, parent_id: parent, title: String(a.title || '').slice(0, 300), icon: String(a.icon || '').slice(0, 16), kind, pos: await nextPos(w.id, parent), updated_by: ctx.userId };
      const { data: page, error } = await db.from('pages').insert(row).select('*').single();
      if (error) throw error;
      let blocks: any[] = [];
      if (kind === 'page') {
        const parsed = mdToBlocks(a.markdown || '');
        blocks = await insertBlocks(ctx, page, parsed.length ? parsed : [{ id: uid(), type: 'p', text: '', indent: 0, props: {} }], 0);
      }
      await broadcast(w.id, { from: 'mcp', up: { pages: [pageRowOut(page)], blocks: blocks.map(blockRowOut) }, del: {} });
      return `${kind === 'folder' ? 'Dossier' : 'Page'} créé${kind === 'folder' ? '' : 'e'} : « ${page.title || 'Sans titre'} » (id: ${id}), ${blocks.length} bloc(s).`;
    }

    case 'append_to_page': {
      const p = await getPage(ctx, a.page_id);
      if (p.kind === 'folder') throw new UserError('C’est un dossier : crée plutôt une page dedans avec create_page.');
      const parsed = mdToBlocks(a.markdown || '');
      if (!parsed.length) throw new UserError('markdown est vide');
      const existing = await pageBlocks(p.id);
      await saveVersion(ctx, p, existing);
      // une page vide contient un paragraphe vide : on le remplace
      const del = existing.length === 1 && existing[0].type === 'p' && !htmlToMd(existing[0].text).trim() ? [existing[0].id] : [];
      if (del.length) await db.from('blocks').delete().in('id', del);
      const start = existing.length && !del.length ? existing[existing.length - 1].pos + 1 : 0;
      const rows = await insertBlocks(ctx, p, parsed, start);
      const page = await touchPage(ctx, p.id);
      await broadcast(p.workspace_id, { from: 'mcp', up: { pages: [pageRowOut(page)], blocks: rows.map(blockRowOut) }, del: { blocks: del } });
      return `${rows.length} bloc(s) ajouté(s) à « ${p.title || 'Sans titre'} ».`;
    }

    case 'replace_page_content': {
      const p = await getPage(ctx, a.page_id);
      if (p.kind === 'folder') throw new UserError('Un dossier n’a pas de contenu.');
      const existing = await pageBlocks(p.id);
      await saveVersion(ctx, p, existing);
      const parsed = mdToBlocks(a.markdown || '');
      if (existing.length) await db.from('blocks').delete().eq('page_id', p.id);
      const rows = await insertBlocks(ctx, p, parsed.length ? parsed : [{ id: uid(), type: 'p', text: '', indent: 0, props: {} }], 0);
      const page = await touchPage(ctx, p.id);
      await broadcast(p.workspace_id, { from: 'mcp', up: { pages: [pageRowOut(page)], blocks: rows.map(blockRowOut) }, del: { blocks: existing.map((b) => b.id) } });
      return `Contenu de « ${p.title || 'Sans titre'} » remplacé (${rows.length} bloc(s)). L’ancienne version est dans l’historique.`;
    }

    case 'update_page': {
      const p = await getPage(ctx, a.page_id);
      const patch: Record<string, unknown> = {};
      if (typeof a.title === 'string') patch.title = a.title.slice(0, 300);
      if (typeof a.icon === 'string') patch.icon = a.icon.slice(0, 16);
      if (a.parent_id !== undefined) {
        const parent = a.parent_id || null;
        if (parent) {
          const pp = await getPage(ctx, parent);
          if (pp.workspace_id !== p.workspace_id) throw new UserError('Le nouveau parent est dans un autre espace.');
          const byId = new Map((await allPages(p.workspace_id)).map((x) => [x.id, x]));
          for (let x: any = byId.get(parent); x; x = byId.get(x.parent_id)) if (x.id === p.id) throw new UserError('Impossible de déplacer une page dans elle-même.');
        }
        patch.parent_id = parent;
        patch.pos = await nextPos(p.workspace_id, parent);
      }
      if (typeof a.trashed === 'boolean') { patch.trashed = a.trashed; patch.trashed_at = a.trashed ? Date.now() : null; }
      if (!Object.keys(patch).length) throw new UserError('Rien à modifier : donne title, icon, parent_id ou trashed.');
      if (patch.title !== undefined || patch.icon !== undefined) await saveVersion(ctx, p, await pageBlocks(p.id));
      const page = await touchPage(ctx, p.id, patch);
      await broadcast(p.workspace_id, { from: 'mcp', up: { pages: [pageRowOut(page)], blocks: [] }, del: {} });
      return `« ${page.title || 'Sans titre'} » mis à jour (${Object.keys(patch).filter((k) => k !== 'pos' && k !== 'trashed_at').join(', ')}).`;
    }
  }
  throw new UserError('Outil inconnu : ' + name);
}

/* ---------- JSON-RPC / MCP ---------- */

async function handle(msg: any, ctx: Ctx) {
  const { id, method, params } = msg || {};
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return fail(-32600, 'Invalid Request');
  if (id === undefined) return null; // notification

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: 'ReNotion est un espace de notes partagé (pages, dossiers, blocs). Utilise list_pages ou search pour trouver les id, read_page pour lire, et create_page / append_to_page / replace_page_content pour écrire en Markdown. Les membres connectés voient les modifications en direct ; une version est sauvegardée avant chaque modification.',
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      try {
        const text = await callTool(ctx, params?.name, params?.arguments || {});
        return reply({ content: [{ type: 'text', text }] });
      } catch (e) {
        const message = e instanceof UserError ? e.message : 'Erreur interne : ' + ((e as Error)?.message || String(e));
        if (!(e instanceof UserError)) console.error(e);
        return reply({ content: [{ type: 'text', text: message }], isError: true });
      }
    }
    case 'resources/list': return reply({ resources: [] });
    case 'prompts/list': return reply({ prompts: [] });
    default:
      return fail(-32601, 'Method not found: ' + method);
  }
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', ...extra } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);
  if (url.pathname.includes('/.well-known/')) return json({ error: 'not_found' }, 404);

  const fromPath = url.pathname.split('/').find((s) => s.startsWith('rn_')) || '';
  const fromHeader = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const token = fromPath || (fromHeader.startsWith('rn_') ? fromHeader : '');
  const ctx = token ? await authenticate(token) : null;
  if (!ctx) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Jeton ReNotion manquant ou invalide. Crée-en un dans Paramètres → Connecter un assistant.' } }, 401);

  if (req.method === 'GET') return new Response('Ce serveur MCP répond en POST (pas de flux SSE).', { status: 405, headers: { ...cors, Allow: 'POST' } });
  if (req.method === 'DELETE') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }

  const session = req.headers.get('mcp-session-id') || crypto.randomUUID();
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m, ctx)))).filter(Boolean);
    return out.length ? json(out, 200, { 'Mcp-Session-Id': session }) : new Response(null, { status: 202, headers: cors });
  }
  const out = await handle(body, ctx);
  return out ? json(out, 200, { 'Mcp-Session-Id': session }) : new Response(null, { status: 202, headers: cors });
});
