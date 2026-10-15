'use strict';

/* Annuler / Rétablir (par personne, par page) et historique des versions. */

/*
 * Chaque modification locale est enregistrée comme une liste de différences par bloc
 * (avant / après, avec le bloc précédent pour la position). Annuler n'applique l'inverse
 * qu'à ces blocs : les modifications faites en même temps par les autres membres sur
 * d'autres blocs ne sont pas touchées.
 */
const History = (() => {
  const LIMIT = 200;
  const stacks = {}; // pageId -> { undo: [], redo: [] }
  const last = {}; // pageId -> dernier état validé
  const timers = {};
  let applying = false;

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const stack = (pid) => (stacks[pid] = stacks[pid] || { undo: [], redo: [] });

  function snap(p) {
    return clone({
      meta: { title: p.title || '', icon: p.icon || '', cover: p.cover || '' },
      blocks: p.blocks.map((b) => { const c = { ...b }; delete c.pos; Object.keys(c).forEach((k) => { if (k[0] === '_') delete c[k]; }); return c; }),
    });
  }

  function ensure(p) { if (p && !last[p.id]) last[p.id] = snap(p); }

  function track(p) {
    if (applying || !p) return;
    if (!last[p.id]) { last[p.id] = snap(p); return; }
    clearTimeout(timers[p.id]);
    timers[p.id] = setTimeout(() => commit(p.id), 700);
  }

  function diff(before, after) {
    const index = (list) => new Map(list.map((b, i) => [b.id, { b, prev: i ? list[i - 1].id : null }]));
    const bm = index(before.blocks);
    const am = index(after.blocks);
    const changes = [];
    for (const id of new Set([...bm.keys(), ...am.keys()])) {
      const x = bm.get(id) || null;
      const y = am.get(id) || null;
      if (JSON.stringify(x) !== JSON.stringify(y)) changes.push({ id, before: x, after: y });
    }
    const meta = JSON.stringify(before.meta) !== JSON.stringify(after.meta) ? { before: before.meta, after: after.meta } : null;
    return changes.length || meta ? { changes, meta } : null;
  }

  function commit(pid) {
    clearTimeout(timers[pid]);
    delete timers[pid];
    const p = S.pages[pid];
    if (!p || !last[pid]) return;
    const now = snap(p);
    const d = diff(last[pid], now);
    if (!d) return;
    const before = last[pid];
    last[pid] = now;
    const st = stack(pid);
    st.undo.push({ ...d, at: Date.now() });
    if (st.undo.length > LIMIT) st.undo.shift();
    st.redo = [];
    Versions.noteEdit(p, before);
    buttons();
  }

  function commitAll() { Object.keys(timers).forEach(commit); }

  // Un changement venu d'un autre membre devient la nouvelle base, sans entrée d'annulation
  function rebase(pid) {
    const p = S.pages[pid];
    if (!p) { delete last[pid]; return; }
    if (last[pid]) last[pid] = snap(p);
  }

  function apply(pid, entry, dir) {
    const p = S.pages[pid];
    if (!p) return null;
    applying = true;
    const targets = [];
    for (const ch of entry.changes) {
      const i = p.blocks.findIndex((b) => b.id === ch.id);
      if (i >= 0) p.blocks.splice(i, 1);
      if (ch[dir]) targets.push(ch[dir]);
    }
    let pending = targets;
    while (pending.length) {
      const rest = [];
      for (const t of pending) {
        if (t.prev === null) p.blocks.unshift(clone(t.b));
        else {
          const j = p.blocks.findIndex((b) => b.id === t.prev);
          if (j >= 0) p.blocks.splice(j + 1, 0, clone(t.b));
          else rest.push(t);
        }
      }
      if (rest.length === pending.length) { rest.forEach((t) => p.blocks.push(clone(t.b))); break; }
      pending = rest;
    }
    if (entry.meta) Object.assign(p, entry.meta[dir]);
    if (!p.blocks.length && !isFolder(p)) p.blocks.push({ id: uid(), type: 'p', text: '', indent: 0 });
    p.updatedAt = Date.now();
    last[pid] = snap(p);
    applying = false;
    save();
    const focus = entry.changes.map((c) => c[dir] && c[dir].b.id).find((id) => id && p.blocks.some((b) => b.id === id));
    return { focus };
  }

  function run(pid, from, to, dir, label) {
    if (!pid) return;
    commit(pid);
    const st = stack(pid);
    const entry = st[from].pop();
    if (!entry) { toast(dir === 'before' ? 'Rien à annuler' : 'Rien à rétablir'); return; }
    st[to].push(entry);
    const res = apply(pid, entry, dir);
    if (pid === current) {
      if (entry.meta) render();
      else renderBlocks();
      if (res && res.focus) focusBlock(res.focus, 'end');
    }
    buttons();
    if (label) status(label);
  }
  const status = (t) => { const el = $('#saved'); if (el) el.textContent = t; };

  const undo = (pid) => run(pid, 'undo', 'redo', 'before', 'Annulé');
  const redo = (pid) => run(pid, 'redo', 'undo', 'after', 'Rétabli');

  function buttons() {
    const st = current && stacks[current];
    const u = $('#btn-undo'); const r = $('#btn-redo');
    if (u) u.disabled = !(st && (st.undo.length || timers[current]));
    if (r) r.disabled = !(st && st.redo.length);
  }

  function reset() { Object.keys(last).forEach((k) => delete last[k]); Object.keys(stacks).forEach((k) => delete stacks[k]); }

  return { snap, ensure, track, commit, commitAll, rebase, undo, redo, buttons, reset, get applying() { return applying; } };
})();

/* ---------- Versions ---------- */

const Versions = (() => {
  const EVERY = 5 * 60 * 1000; // une version au plus toutes les 5 min pendant l'édition
  const LOCAL_KEY = 'renotion:versions';
  const dirty = {};
  const lastSaved = {}; // pageId -> { at, json }
  const baseline = {};

  const data = (p, s) => ({ title: s.meta.title, icon: s.meta.icon, cover: s.meta.cover, blocks: s.blocks });

  async function save(p, s, reason) {
    if (!p || isFolder(p)) return;
    const d = data(p, s || History.snap(p));
    const json = JSON.stringify(d);
    if (lastSaved[p.id] && lastSaved[p.id].json === json) return;
    lastSaved[p.id] = { at: Date.now(), json };
    try {
      if (CLOUD) await Cloud.saveVersion(p.id, d, reason || null);
      else {
        const all = readLocal();
        const list = all[p.id] = all[p.id] || [];
        list.unshift({ id: uid(), created_at: new Date().toISOString(), reason: reason || null, data: d });
        all[p.id] = list.slice(0, 20);
        localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
      }
    } catch (err) {
      console.error('version', err);
      delete lastSaved[p.id];
    }
  }

  function readLocal() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch (e) { return {}; } }

  // Appelé à chaque modification validée : on garde l'état d'avant la première modification de la session
  function noteEdit(p, before) {
    if (isFolder(p)) return;
    const empty = !before.meta.title && before.blocks.every((b) => b.type === 'p' && !plain(b.text).trim());
    if (!baseline[p.id]) { baseline[p.id] = true; if (!empty) save(p, before, 'Avant tes modifications'); }
    dirty[p.id] = true;
  }

  function leave(pid) {
    const p = pid && S.pages[pid];
    if (p && dirty[pid]) { dirty[pid] = false; save(p, null, null); }
  }

  setInterval(() => {
    for (const pid of Object.keys(dirty)) {
      if (!dirty[pid]) continue;
      const ls = lastSaved[pid];
      if (!ls || Date.now() - ls.at > EVERY) { dirty[pid] = false; save(S.pages[pid], null, null); }
    }
  }, 60000);

  async function list(pid) {
    if (CLOUD) return Cloud.listVersions(pid);
    return (readLocal()[pid] || []).map((v) => ({ ...v }));
  }
  async function get(v) {
    if (v.data) return v.data;
    return CLOUD ? Cloud.getVersion(v.id) : null;
  }

  /* ---------- Fenêtre d'historique ---------- */

  function preview(d) {
    const box = h('div', { class: 'blocks ver-preview' });
    const counters = [];
    const lastType = [];
    let hideAbove = Infinity;
    for (const b of d.blocks || []) {
      const ind = b.indent || 0;
      if (ind > hideAbove) continue;
      hideAbove = b.type === 'toggle' && b.collapsed ? ind : Infinity;
      counters.length = ind + 1;
      lastType.length = ind + 1;
      let num = 0;
      if (b.type === 'ol') num = counters[ind] = lastType[ind] === 'ol' ? counters[ind] + 1 : 1;
      lastType[ind] = b.type;
      box.append(blockEl(b, num, false));
    }
    box.querySelectorAll('[contenteditable]').forEach((el) => el.setAttribute('contenteditable', 'false'));
    box.querySelectorAll('[data-act], [draggable]').forEach((el) => { el.removeAttribute('data-act'); el.removeAttribute('draggable'); });
    box.querySelectorAll('.handle, .tbl-add, .code-tools, .media-tools').forEach((el) => el.remove());
    Media.hydrate(box);
    return box;
  }

  async function open(p) {
    if (!p || isFolder(p)) return;
    History.commit(p.id);
    await save(p, null, null); // l'état actuel fait partie de la liste
    closePop();
    const listEl = h('div', { class: 'ver-list' }, h('div', { class: 'empty-res' }, 'Chargement…'));
    const view = h('div', { class: 'ver-view' }, h('div', { class: 'empty-res' }, 'Choisis une version à gauche.'));
    const foot = h('div', { class: 'ver-foot' });
    const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) closePop(); } },
      h('div', { class: 'modal wide' },
        h('div', { class: 'ver-head' }, h('h2', {}, `Historique · ${iconOf(p)} ${titleOf(p)}`), h('button', { class: 'icon-btn', onclick: closePop, title: 'Fermer' }, '✕')),
        h('div', { class: 'ver-layout' }, listEl, h('div', { class: 'ver-right' }, view, foot))));
    $('#layer').append(back);

    let versions = [];
    let people = {};
    try {
      [versions, people] = await Promise.all([list(p.id), CLOUD ? Cloud.memberNames() : Promise.resolve({})]);
    } catch (err) {
      listEl.innerHTML = '';
      listEl.append(h('div', { class: 'empty-res' }, 'Impossible de charger l’historique : ' + err.message));
      return;
    }
    listEl.innerHTML = '';
    if (!versions.length) { listEl.append(h('div', { class: 'empty-res' }, 'Aucune version pour l’instant. Elles sont créées automatiquement pendant l’édition.')); return; }

    const pick = async (v, el) => {
      listEl.querySelectorAll('.ver-item').forEach((x) => x.classList.toggle('sel', x === el));
      view.innerHTML = '';
      foot.innerHTML = '';
      view.append(h('div', { class: 'empty-res' }, 'Chargement…'));
      const d = await get(v);
      view.innerHTML = '';
      if (!d) { view.append(h('div', { class: 'empty-res' }, 'Version introuvable.')); return; }
      view.append(h('div', { class: 'ver-title' }, `${d.icon || iconOf(p)} ${d.title || 'Sans titre'}`), preview(d));
      const isCurrent = v === versions[0];
      foot.append(
        h('span', { class: 'muted' }, isCurrent ? 'C’est la version actuelle.' : `${(d.blocks || []).length} blocs`),
        isCurrent ? null : h('button', { class: 'btn primary', onclick: () => restore(p, d) }, 'Restaurer cette version'));
    };

    versions.forEach((v, i) => {
      const who = people[v.created_by];
      const el = h('button', { class: 'ver-item' },
        h('div', { class: 'ver-when' }, i === 0 ? 'Actuelle' : relTime(Date.parse(v.created_at))),
        h('div', { class: 'ver-sub' },
          who ? h('span', { class: 'dot', style: { background: who.color } }) : null,
          who ? who.name : CLOUD ? 'Membre' : 'Toi',
          v.reason ? ' · ' + v.reason : '',
          ' · ' + new Date(v.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })));
      el.addEventListener('click', () => pick(v, el));
      listEl.append(el);
    });
    const first = listEl.querySelector('.ver-item:nth-child(2)') || listEl.querySelector('.ver-item');
    first.click();
  }

  async function restore(p, d) {
    if (!confirm('Restaurer cette version ? La page actuelle est conservée dans l’historique, et tu peux aussi faire Ctrl+Z juste après.')) return;
    History.commit(p.id);
    await save(p, null, 'Avant restauration');
    History.ensure(p);
    p.title = d.title || '';
    p.icon = d.icon || '';
    p.cover = d.cover || '';
    p.blocks = JSON.parse(JSON.stringify(d.blocks || [])).map((b) => { delete b.pos; return b; });
    if (!p.blocks.length) p.blocks.push({ id: uid(), type: 'p', text: '', indent: 0 });
    touch(p);
    History.commit(p.id);
    closePop();
    render();
    toast('Version restaurée', 'Annuler', () => History.undo(p.id));
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { History.commitAll(); leave(current); } });

  return { noteEdit, leave, open, save };
})();
