'use strict';

/* ReNotion en ligne : comptes, espaces partagés, synchronisation temps réel (Supabase). */

const Cloud = (() => {
  const CFG = window.RN_CONFIG || {};
  const EMAIL_DOMAIN = 'renotion.local';
  const CLIENT = Math.random().toString(36).slice(2, 10);
  let sb = null;
  let user = null;
  let ws = null; // { id, name, invite_code, role, display_name, color }
  let memberships = [];
  let channel = null;
  let subscribedOnce = false;
  const shadow = { pages: new Map(), blocks: new Map() };
  let timer = null;
  let firstPending = 0;
  let flushing = false;
  let again = false;
  let retryTimer = null;
  let me = { page: null, block: null };
  let others = [];

  /* ---------- Utilitaires ---------- */

  const status = (t) => { const el = $('#saved'); if (el) el.textContent = t; };
  const toEmail = (pseudo) => `${pseudo.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
  const pseudoOf = (u) => (u && u.email ? u.email.split('@')[0] : '');
  const fnUrl = (name) => `${CFG.supabaseUrl}/functions/v1/${name}`;

  function pageRow(p) {
    return {
      id: p.id, workspace_id: ws.id, parent_id: p.parentId || null, title: p.title || '', icon: p.icon || '',
      cover: p.cover || '', pos: Number(p.pos) || 0, trashed: !!p.trashed, trashed_at: p.trashedAt || null, kind: p.kind || 'page',
    };
  }
  function blockRow(b, p) {
    const props = {};
    for (const k of PROP_KEYS) if (b[k] !== undefined && b[k] !== null) props[k] = b[k];
    return { id: b.id, page_id: p.id, workspace_id: ws.id, pos: b.pos, type: b.type, text: b.text || '', indent: b.indent || 0, props };
  }
  function rowToBlock(r) {
    const props = r.props || {};
    const b = { id: r.id, type: r.type, text: r.text || '', indent: r.indent || 0, pos: r.pos };
    for (const k of PROP_KEYS) if (props[k] !== undefined) b[k] = props[k];
    return b;
  }

  // Positions fractionnaires : on garde celles qui sont déjà dans l'ordre et on intercale les autres.
  function assignPositions(blocks) {
    let last = -Infinity;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (typeof b.pos === 'number' && b.pos > last) {
        let ok = true;
        for (let j = i + 1; j < blocks.length; j++) {
          if (typeof blocks[j].pos === 'number') { ok = blocks[j].pos > b.pos || blocks[j].pos <= last; break; }
        }
        if (ok) { last = b.pos; continue; }
      }
      let next = Infinity;
      for (let j = i + 1; j < blocks.length; j++) if (typeof blocks[j].pos === 'number' && blocks[j].pos > last) { next = blocks[j].pos; break; }
      let pos;
      if (last === -Infinity) pos = next === Infinity ? 0 : next - 1;
      else pos = next === Infinity ? last + 1 : (last + next) / 2;
      if (pos === last || pos === next) { blocks.forEach((x, k) => { x.pos = k; }); return; }
      b.pos = pos;
      last = pos;
    }
  }

  /* ---------- Envoi des modifications ---------- */

  function schedule() {
    if (!ws) return;
    status('Synchronisation…');
    if (!firstPending) firstPending = Date.now();
    clearTimeout(timer);
    // envoi rapide pendant la frappe, au plus tard toutes les 800 ms
    timer = setTimeout(flush, Date.now() - firstPending > 800 ? 0 : 250);
  }

  function collect() {
    const up = { pages: [], blocks: [] };
    const del = { pages: [], blocks: [] };
    const seenP = new Set();
    const seenB = new Set();
    for (const p of Object.values(S.pages)) {
      assignPositions(p.blocks);
      const pr = pageRow(p);
      const ps = JSON.stringify(pr);
      seenP.add(p.id);
      if (shadow.pages.get(p.id) !== ps) up.pages.push(pr);
      for (const b of p.blocks) {
        const br = blockRow(b, p);
        const bs = JSON.stringify(br);
        seenB.add(b.id);
        if (shadow.blocks.get(b.id) !== bs) up.blocks.push(br);
      }
    }
    for (const id of shadow.pages.keys()) if (!seenP.has(id)) del.pages.push(id);
    for (const id of shadow.blocks.keys()) if (!seenB.has(id)) del.blocks.push(id);
    return { up, del };
  }

  async function chunked(rows, fn) {
    for (let i = 0; i < rows.length; i += 400) {
      const { error } = await fn(rows.slice(i, i + 400));
      if (error) throw error;
    }
  }

  async function flush() {
    clearTimeout(timer);
    if (!ws) return;
    if (flushing) { again = true; return; }
    flushing = true;
    firstPending = 0;
    const { up, del } = collect();
    const empty = !up.pages.length && !up.blocks.length && !del.pages.length && !del.blocks.length;
    if (empty) { flushing = false; status('Synchronisé'); return; }

    // on considère l'envoi comme fait ; en cas d'échec on invalide pour réessayer
    up.pages.forEach((r) => shadow.pages.set(r.id, JSON.stringify(r)));
    up.blocks.forEach((r) => shadow.blocks.set(r.id, JSON.stringify(r)));
    del.pages.forEach((id) => shadow.pages.delete(id));
    del.blocks.forEach((id) => shadow.blocks.delete(id));

    const payload = { from: CLIENT, up, del };
    if (channel) {
      if (JSON.stringify(payload).length < 200000) channel.send({ type: 'broadcast', event: 'ops', payload });
    }
    try {
      await chunked(up.pages, (rows) => sb.from('pages').upsert(rows));
      await chunked(up.blocks, (rows) => sb.from('blocks').upsert(rows));
      if (del.blocks.length) await chunked(del.blocks, (ids) => sb.from('blocks').delete().in('id', ids));
      if (del.pages.length) await chunked(del.pages, (ids) => sb.from('pages').delete().in('id', ids));
      if (channel && JSON.stringify(payload).length >= 200000) channel.send({ type: 'broadcast', event: 'reload', payload: { from: CLIENT } });
      status('Synchronisé');
    } catch (err) {
      console.error('sync', err);
      up.pages.forEach((r) => shadow.pages.delete(r.id));
      up.blocks.forEach((r) => shadow.blocks.delete(r.id));
      del.pages.forEach((id) => shadow.pages.set(id, '?'));
      del.blocks.forEach((id) => shadow.blocks.set(id, '?'));
      status('Hors ligne · nouvel essai…');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(schedule, 4000);
    } finally {
      flushing = false;
      if (again) { again = false; schedule(); }
    }
  }

  /* ---------- Réception des modifications ---------- */

  function isDirtyBlock(b) {
    const p = Object.values(S.pages).find((x) => x.blocks.includes(b));
    return p && shadow.blocks.get(b.id) !== JSON.stringify(blockRow(b, p));
  }

  function findBlock(id) {
    for (const p of Object.values(S.pages)) {
      const i = p.blocks.findIndex((b) => b.id === id);
      if (i >= 0) return { p, i, b: p.blocks[i] };
    }
    return null;
  }

  function insertSorted(blocks, b) {
    let i = blocks.findIndex((x) => typeof x.pos === 'number' && x.pos > b.pos);
    if (i < 0) i = blocks.length;
    blocks.splice(i, 0, b);
  }

  // Applique des lignes venant d'un autre membre (broadcast ou rechargement)
  function applyRemote({ up = {}, del = {} }, opts = {}) {
    const focusedId = (() => { const r = document.activeElement && document.activeElement.closest && document.activeElement.closest('.block'); return r ? r.dataset.id : null; })();
    const titleFocused = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('page-title');
    let touchedCurrent = false;
    let structure = false;
    History.commitAll(); // nos modifications en cours restent annulables séparément
    const touchedPages = new Set();

    for (const r of up.pages || []) {
      let p = S.pages[r.id];
      if (p && opts.keepDirty && shadow.pages.get(p.id) !== JSON.stringify(pageRow(p))) continue;
      if (!p) { p = S.pages[r.id] = { id: r.id, blocks: [], createdAt: Date.now() }; structure = true; }
      if (p.parentId !== (r.parent_id || null) || p.trashed !== !!r.trashed || p.pos !== r.pos || p.title !== r.title || p.icon !== r.icon || (p.kind || 'page') !== (r.kind || 'page')) structure = true;
      if (!(titleFocused && p.id === current)) p.title = r.title || '';
      Object.assign(p, { parentId: r.parent_id || null, icon: r.icon || '', cover: r.cover || '', pos: r.pos, trashed: !!r.trashed, trashedAt: r.trashed_at || null, kind: r.kind || 'page', updatedAt: Date.now() });
      shadow.pages.set(p.id, JSON.stringify(pageRow(p)));
      touchedPages.add(p.id);
      if (p.id === current) touchedCurrent = true;
    }

    for (const r of up.blocks || []) {
      const page = S.pages[r.page_id];
      if (!page) continue;
      touchedPages.add(page.id);
      const found = findBlock(r.id);
      const nb = rowToBlock(r);
      if (found) {
        if ((found.b.id === focusedId || opts.keepDirty) && isDirtyBlock(found.b)) {
          // tableau modifié des deux côtés : on fusionne cellule par cellule
          const base = found.b.type === 'table' && nb.type === 'table' && JSON.parse(shadow.blocks.get(r.id) || 'null');
          const merged = base && Table.merge(base.props.rows, found.b.rows, nb.rows);
          if (!merged) continue;
          shadow.blocks.set(r.id, JSON.stringify(blockRow(nb, page)));
          Object.assign(found.b, { rows: merged, headerRow: nb.headerRow, headerCol: nb.headerCol });
          if (page.id === current) touchedCurrent = true;
          schedule();
          continue;
        }
        const moved = found.b.pos !== nb.pos || found.p !== page;
        for (const k of PROP_KEYS) delete found.b[k];
        Object.assign(found.b, nb);
        if (moved) { found.p.blocks.splice(found.i, 1); insertSorted(page.blocks, found.b); }
      } else insertSorted(page.blocks, nb);
      shadow.blocks.set(r.id, JSON.stringify(blockRow(found ? found.b : nb, page)));
      if (page.id === current) touchedCurrent = true;
    }

    for (const id of del.blocks || []) {
      const found = findBlock(id);
      shadow.blocks.delete(id);
      if (!found) continue;
      touchedPages.add(found.p.id);
      found.p.blocks.splice(found.i, 1);
      if (found.p.id === current) touchedCurrent = true;
    }
    for (const id of del.pages || []) {
      shadow.pages.delete(id);
      if (S.pages[id]) { S.pages[id].blocks.forEach((b) => shadow.blocks.delete(b.id)); delete S.pages[id]; structure = true; }
      if (id === current) touchedCurrent = true;
    }

    touchedPages.forEach((pid) => History.rebase(pid));
    (del.pages || []).forEach((pid) => History.rebase(pid));
    if (structure) renderSidebar();
    const p = S.pages[current];
    if (!p || isDeleted(p)) { if (structure || touchedCurrent) render(); return; }
    if (touchedCurrent) {
      if (!p.blocks.length && !isFolder(p)) p.blocks.push({ id: uid(), type: 'p', text: '', indent: 0 });
      renderTop();
      if (isFolder(p)) { if (!titleFocused) renderPage(); return; }
      const t = $('.page-title');
      if (t && !titleFocused && t.textContent !== p.title) t.textContent = p.title;
      rerenderKeepCaret();
    }
  }

  function rerenderKeepCaret() {
    const tf = Table.saveFocus();
    const ae = document.activeElement;
    const row = ae && ae.closest && ae.closest('.block');
    let id = null;
    let off = null;
    if (row && $('#blocks').contains(row)) {
      id = row.dataset.id;
      const c = row.querySelector('.content[contenteditable]');
      off = c ? caretOffset(c) : null;
    }
    const scroller = $('#scroller');
    const top = scroller.scrollTop;
    renderBlocks();
    scroller.scrollTop = top;
    if (tf) Table.restoreFocus(tf);
    else if (id) focusBlock(id, off == null || off < 0 ? 'end' : off);
  }

  /* ---------- Chargement ---------- */

  async function fetchAll(table) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select('*').eq('workspace_id', ws.id).order('pos').range(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }

  async function loadWorkspace() {
    status('Chargement…');
    const [pages, blocks] = await Promise.all([fetchAll('pages'), fetchAll('blocks')]);
    S = { version: 1, pages: {} };
    History.reset();
    shadow.pages.clear();
    shadow.blocks.clear();
    for (const r of pages) {
      S.pages[r.id] = {
        id: r.id, parentId: r.parent_id, title: r.title, icon: r.icon, cover: r.cover, pos: r.pos, trashed: r.trashed,
        trashedAt: r.trashed_at, kind: r.kind || 'page', createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at), blocks: [],
      };
    }
    for (const r of blocks) if (S.pages[r.page_id]) S.pages[r.page_id].blocks.push(rowToBlock(r));
    for (const p of Object.values(S.pages)) {
      shadow.pages.set(p.id, JSON.stringify(pageRow(p)));
      p.blocks.forEach((b) => shadow.blocks.set(b.id, JSON.stringify(blockRow(b, p))));
      if (!p.blocks.length && !isFolder(p)) p.blocks.push({ id: uid(), type: 'p', text: '', indent: 0 });
    }
    status('Synchronisé');
  }

  // Après une coupure : on récupère l'état du serveur sans écraser ce qui n'est pas encore envoyé
  async function resync() {
    try {
      await flush();
      const [pages, blocks] = await Promise.all([fetchAll('pages'), fetchAll('blocks')]);
      const pIds = new Set(pages.map((r) => r.id));
      const bIds = new Set(blocks.map((r) => r.id));
      const del = {
        pages: [...shadow.pages.keys()].filter((id) => !pIds.has(id)),
        blocks: [...shadow.blocks.keys()].filter((id) => !bIds.has(id)),
      };
      applyRemote({ up: { pages, blocks }, del }, { keepDirty: true });
    } catch (err) { console.error('resync', err); }
  }

  /* ---------- Temps réel & présence ---------- */

  async function connect() {
    if (channel) await sb.removeChannel(channel);
    subscribedOnce = false;
    await sb.realtime.setAuth();
    channel = sb.channel('ws:' + ws.id, { config: { private: true, broadcast: { self: false }, presence: { key: CLIENT } } });
    channel
      .on('broadcast', { event: 'ops' }, ({ payload }) => { if (payload && payload.from !== CLIENT) applyRemote(payload); })
      .on('broadcast', { event: 'reload' }, ({ payload }) => { if (payload && payload.from !== CLIENT) resync(); })
      .on('presence', { event: 'sync' }, renderPresence)
      .subscribe((st) => {
        if (st === 'SUBSCRIBED') {
          track();
          if (subscribedOnce) resync();
          subscribedOnce = true;
        } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') status('Temps réel indisponible…');
      });
  }

  let trackTimer = null;
  function track() {
    if (!channel) return;
    clearTimeout(trackTimer);
    trackTimer = setTimeout(() => {
      channel.track({ uid: user.id, name: ws.display_name, color: ws.color, page: me.page, block: me.block });
    }, 150);
  }

  function here(blockId) {
    const changed = me.page !== current || me.block !== blockId;
    me = { page: current, block: blockId };
    if (changed) track();
  }

  function renderPresence() {
    if (!channel) return;
    const state = channel.presenceState();
    others = [];
    for (const [key, metas] of Object.entries(state)) {
      if (key === CLIENT || !metas[0]) continue;
      others.push(metas[0]);
    }
    const box = $('#people');
    if (box) {
      box.innerHTML = '';
      const seen = new Set();
      others.forEach((o) => {
        if (seen.has(o.uid)) return;
        seen.add(o.uid);
        const pg = S.pages[o.page];
        box.append(h('button', {
          class: 'avatar' + (o.page === current ? '' : ' away'), style: { background: o.color },
          title: `${o.name}${pg ? ' · ' + titleOf(pg) : ''}`, onclick: () => { if (pg && !isDeleted(pg)) go(pg.id); },
        }, (o.name || '?').trim().charAt(0).toUpperCase()));
      });
    }
    decorate();
  }

  function decorate() {
    document.querySelectorAll('.block.remote').forEach((el) => { el.classList.remove('remote'); el.removeAttribute('data-who'); el.style.removeProperty('--rc'); });
    for (const o of others) {
      if (o.page !== current || !o.block) continue;
      const el = document.querySelector(`.block[data-id="${o.block}"]`);
      if (!el) continue;
      el.classList.add('remote');
      el.dataset.who = o.name;
      el.style.setProperty('--rc', o.color);
    }
  }

  /* ---------- Écran de connexion ---------- */

  function authScreen(msg) {
    document.body.classList.add('auth-mode');
    const invite = new URLSearchParams(location.search).get('invite') || '';
    let mode = invite ? 'signup' : 'login';
    const root = $('#auth') || document.body.appendChild(h('div', { id: 'auth' }));
    const draw = (err) => {
      root.innerHTML = '';
      const f = {
        code: h('input', { type: 'text', placeholder: 'Code d’invitation', value: invite, autocomplete: 'off', required: true }),
        pseudo: h('input', { type: 'text', placeholder: 'Pseudo', autocomplete: 'username', autocapitalize: 'none', required: true }),
        name: h('input', { type: 'text', placeholder: 'Nom affiché (optionnel)', autocomplete: 'nickname' }),
        pass: h('input', { type: 'password', placeholder: 'Mot de passe', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true, minlength: 8 }),
      };
      const btn = h('button', { class: 'btn primary', type: 'submit' }, mode === 'login' ? 'Se connecter' : 'Créer mon compte');
      const form = h('form', { class: 'auth-card' },
        h('div', { class: 'auth-logo' }, '📓'),
        h('h1', {}, 'ReNotion'),
        h('div', { class: 'seg auth-tabs' },
          h('button', { type: 'button', class: mode === 'login' ? 'on' : '', onclick: () => { mode = 'login'; draw(); } }, 'Connexion'),
          h('button', { type: 'button', class: mode === 'signup' ? 'on' : '', onclick: () => { mode = 'signup'; draw(); } }, 'Inscription')),
        mode === 'signup' ? f.code : null, f.pseudo, mode === 'signup' ? f.name : null, f.pass,
        err ? h('div', { class: 'auth-err' }, err) : null,
        btn,
        h('p', { class: 'muted' }, mode === 'login' ? 'Pas encore de compte ? Demande un lien d’invitation à un membre.' : 'Pas besoin d’e-mail : retiens bien ton pseudo et ton mot de passe.'));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        btn.disabled = true;
        btn.textContent = 'Un instant…';
        try {
          if (mode === 'signup') {
            const res = await fetch(fnUrl('signup'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey },
              body: JSON.stringify({ code: f.code.value, username: f.pseudo.value, password: f.pass.value, displayName: f.name.value }),
            });
            const out = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(out.error || 'Inscription impossible');
          }
          const { error } = await sb.auth.signInWithPassword({ email: toEmail(f.pseudo.value), password: f.pass.value });
          if (error) throw new Error(/invalid/i.test(error.message) ? 'Pseudo ou mot de passe incorrect' : error.message);
          if (invite) history.replaceState(null, '', location.pathname + location.hash);
          root.remove();
          document.body.classList.remove('auth-mode');
          await afterLogin();
        } catch (err) {
          draw(err.message);
        }
      });
      root.append(form);
      (mode === 'signup' && !invite ? f.code : f.pseudo).focus();
    };
    draw(msg);
  }

  async function loadMemberships() {
    const { data, error } = await sb.from('members').select('workspace_id, display_name, color, role, workspaces(id, name, invite_code)').eq('user_id', user.id);
    if (error) throw error;
    memberships = data.filter((m) => m.workspaces).map((m) => ({ ...m.workspaces, role: m.role, display_name: m.display_name, color: m.color }));
  }

  async function afterLogin() {
    const { data } = await sb.auth.getUser();
    user = data.user;
    if (!user) return authScreen();
    const invite = new URLSearchParams(location.search).get('invite');
    let wanted = null;
    if (invite) {
      const { data: wid, error } = await sb.rpc('join_workspace', { code: invite, name: user.user_metadata?.display_name || pseudoOf(user) });
      history.replaceState(null, '', location.pathname + location.hash);
      if (error) toast(error.message); else wanted = wid;
    }
    await loadMemberships();
    if (!memberships.length) return joinScreen();
    const pick = memberships.find((m) => m.id === wanted) || memberships.find((m) => m.id === UI.ws) || memberships[0];
    await openWorkspace(pick);
  }

  function joinScreen() {
    document.body.classList.add('auth-mode');
    const root = $('#auth') || document.body.appendChild(h('div', { id: 'auth' }));
    root.innerHTML = '';
    const code = h('input', { type: 'text', placeholder: 'Code d’invitation', required: true });
    const form = h('form', { class: 'auth-card' }, h('div', { class: 'auth-logo' }, '🔑'), h('h1', {}, 'Rejoindre un espace'),
      h('p', { class: 'muted' }, 'Ton compte n’appartient à aucun espace. Entre un code d’invitation.'), code,
      h('button', { class: 'btn primary', type: 'submit' }, 'Rejoindre'),
      h('button', { class: 'btn', type: 'button', onclick: logout }, 'Se déconnecter'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error } = await sb.rpc('join_workspace', { code: code.value, name: user.user_metadata?.display_name || pseudoOf(user) });
      if (error) return toast(error.message);
      root.remove();
      document.body.classList.remove('auth-mode');
      afterLogin();
    });
    root.append(form);
  }

  async function openWorkspace(m) {
    if (ws) await flush();
    ws = m;
    UI.ws = m.id;
    saveUI();
    $('.workspace span').textContent = m.name;
    try {
      await loadWorkspace();
    } catch (err) {
      console.error(err);
      toast('Impossible de charger l’espace : ' + err.message);
      return;
    }
    if (!Object.keys(S.pages).length) { seedPages(); }
    startApp();
    schedule();
    connect();
  }

  async function logout() {
    try { await flush(); } catch (e) { /* ignore */ }
    if (channel) await sb.removeChannel(channel);
    channel = null;
    ws = null;
    await sb.auth.signOut();
    location.reload();
  }

  /* ---------- Paramètres de l'espace ---------- */

  function settings(body) {
    if (!ws) return;
    const link = `${location.origin}${location.pathname}?invite=${ws.invite_code}`;
    const members = h('div', { class: 'members' }, h('span', { class: 'muted' }, 'Chargement des membres…'));
    sb.from('members').select('user_id, display_name, color, role').eq('workspace_id', ws.id).order('joined_at').then(({ data }) => {
      members.innerHTML = '';
      (data || []).forEach((m) => members.append(h('div', { class: 'member' },
        h('span', { class: 'avatar', style: { background: m.color } }, (m.display_name || '?').charAt(0).toUpperCase()),
        h('span', {}, m.display_name + (m.user_id === user.id ? ' (toi)' : '')),
        m.role === 'owner' ? h('span', { class: 'muted' }, 'propriétaire') : null)));
    });
    const nameInput = h('input', { type: 'text', value: ws.display_name, class: 'field', maxlength: 40 });
    const switcher = memberships.length > 1 ? h('select', { class: 'field', onchange: (e) => { closePop(); openWorkspace(memberships.find((m) => m.id === e.target.value)); } },
      memberships.map((m) => h('option', { value: m.id, selected: m.id === ws.id ? true : null }, m.name))) : null;
    body.append(
      h('p', {}, `Connecté en tant que `, h('b', {}, pseudoOf(user)), ' · espace ', h('b', {}, ws.name)),
      switcher,
      h('p', {}, 'Lien d’invitation pour tes potes :'),
      h('div', { class: 'invite' }, h('input', { type: 'text', class: 'field', readonly: true, value: link, onfocus: (e) => e.target.select() }),
        h('button', { class: 'btn', onclick: () => navigator.clipboard.writeText(link).then(() => toast('Lien copié'), () => toast('Copie impossible')) }, 'Copier')),
      members,
      h('p', {}, 'Ton nom affiché :'),
      h('div', { class: 'invite' }, nameInput, h('button', { class: 'btn', onclick: async () => {
        const v = nameInput.value.trim();
        if (!v) return;
        const { error } = await sb.from('members').update({ display_name: v }).eq('workspace_id', ws.id).eq('user_id', user.id);
        if (error) return toast(error.message);
        ws.display_name = v;
        track();
        toast('Nom mis à jour');
      } }, 'Enregistrer')),
      h('div', { style: { margin: '6px 0 14px' } },
        ws.role === 'owner' ? h('button', { class: 'btn', onclick: async () => {
          if (!confirm('Générer un nouveau code ? L’ancien lien ne marchera plus.')) return;
          const { data, error } = await sb.rpc('rotate_invite', { ws: ws.id });
          if (error) return toast(error.message);
          ws.invite_code = data;
          closePop(); openSettings();
        } }, 'Nouveau lien') : null,
        h('button', { class: 'btn', onclick: async () => {
          const name = prompt('Nom du nouvel espace');
          if (!name) return;
          const { data, error } = await sb.rpc('create_workspace', { ws_name: name });
          if (error) return toast(error.message);
          await loadMemberships();
          closePop();
          openWorkspace(memberships.find((m) => m.id === data));
        } }, 'Créer un espace'),
        h('button', { class: 'btn', onclick: async () => {
          const code = prompt('Code d’invitation (ou lien complet)');
          if (!code) return;
          const c = (code.match(/invite=([0-9a-f]+)/i) || [null, code])[1];
          const { data, error } = await sb.rpc('join_workspace', { code: c, name: ws.display_name });
          if (error) return toast(error.message);
          await loadMemberships();
          closePop();
          openWorkspace(memberships.find((m) => m.id === data));
        } }, 'Rejoindre un espace'),
        h('button', { class: 'btn danger', onclick: logout }, 'Se déconnecter')),
      h('div', { class: 'sep-line' }));
  }

  /* ---------- Démarrage ---------- */

  async function boot() {
    document.body.classList.add('cloud');
    S = { version: 1, pages: {} };
    if (!window.supabase || !CFG.supabaseKey) { toast('Configuration Supabase manquante'); return; }
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
    sb.auth.onAuthStateChange((ev, session) => {
      if (ev === 'TOKEN_REFRESHED' && session) sb.realtime.setAuth(session.access_token);
    });
    const { data } = await sb.auth.getSession();
    if (!data.session) return authScreen();
    await afterLogin();
  }

  window.addEventListener('beforeunload', (e) => {
    if (!ws) return;
    const { up, del } = collect();
    if (up.pages.length || up.blocks.length || del.pages.length || del.blocks.length) {
      flush();
      e.preventDefault();
      e.returnValue = '';
    }
  });
  window.addEventListener('online', () => { if (ws) resync(); });

  /* ---------- Versions ---------- */

  async function saveVersion(pageId, data, reason) {
    if (!ws) return;
    await flush(); // la page doit exister en base avant sa version
    const { error } = await sb.from('page_versions').insert({ page_id: pageId, workspace_id: ws.id, created_by: user.id, reason, data });
    if (error) throw error;
  }
  async function listVersions(pageId) {
    const { data, error } = await sb.from('page_versions').select('id, created_at, created_by, reason').eq('page_id', pageId).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data;
  }
  async function getVersion(id) {
    const { data, error } = await sb.from('page_versions').select('data').eq('id', id).single();
    if (error) throw error;
    return data.data;
  }
  let namesCache = null;
  async function memberNames() {
    if (namesCache && namesCache.ws === ws.id && Date.now() - namesCache.at < 60000) return namesCache.map;
    const { data } = await sb.from('members').select('user_id, display_name, color').eq('workspace_id', ws.id);
    const map = {};
    (data || []).forEach((m) => { map[m.user_id] = { name: m.display_name, color: m.color }; });
    namesCache = { ws: ws.id, at: Date.now(), map };
    return map;
  }

  async function token() {
    const { data } = await sb.auth.getSession();
    return data.session ? data.session.access_token : null;
  }

  return { boot, schedule, flush, here, decorate, settings, token, fnUrl, saveVersion, listVersions, getVersion, memberNames, get config() { return CFG; } };
})();
