'use strict';

/* Sélection de plusieurs blocs (comme Notion) : Ctrl+A ×2, glisser à la souris, Maj+clic, Maj+↑/↓.
   Sur la sélection : copier, couper, coller, supprimer, indenter, transformer, IA. */

const Select = (() => {
  const MIME = 'application/x-renotion-blocks';
  let ids = new Set();
  let anchor = null; // bloc de départ (pour Maj+clic / Maj+flèches)
  let head = null; // bloc qui bouge avec Maj+flèches
  let drag = null; // { mode: 'text' | 'blocks' | 'band', startId, startY }
  let band = null;

  const rows = () => [...document.querySelectorAll('#blocks > .block')];
  const visibleIds = () => rows().map((r) => r.dataset.id);
  const size = () => ids.size;
  const includes = (id) => ids.has(id);

  function paint() {
    const live = new Set(visibleIds());
    for (const id of [...ids]) if (!live.has(id)) ids.delete(id);
    rows().forEach((r) => r.classList.toggle('selected', ids.has(r.dataset.id)));
    document.body.classList.toggle('blocks-selected', ids.size > 0);
  }

  function set(list, anc = anchor, hd = head) {
    ids = new Set(list);
    anchor = anc;
    head = hd;
    paint();
  }

  function clear() {
    if (!ids.size) return;
    ids.clear();
    anchor = head = null;
    paint();
  }

  function dropTextFocus() {
    const ae = document.activeElement;
    if (ae && ae !== document.body && ae.closest && ae.closest('#page')) ae.blur();
    const sel = getSelection();
    if (sel.rangeCount) sel.removeAllRanges();
  }

  function range(a, b) {
    const v = visibleIds();
    let i = v.indexOf(a);
    let j = v.indexOf(b);
    if (i < 0 || j < 0) return [];
    if (i > j) [i, j] = [j, i];
    return v.slice(i, j + 1);
  }

  function selectAll() {
    const v = visibleIds();
    if (!v.length) return;
    dropTextFocus();
    set(v, v[0], v[v.length - 1]);
  }

  // Blocs sélectionnés + leurs enfants (listes dépliantes repliées, indentation), dans l'ordre de la page
  function blocks() {
    const p = pg();
    if (!p) return [];
    const out = [];
    const bl = p.blocks;
    for (let i = 0; i < bl.length; i++) {
      if (!ids.has(bl[i].id)) continue;
      const end = subtreeEnd(i);
      for (let k = i; k < end; k++) out.push(bl[k]);
      i = end - 1;
    }
    return out;
  }

  const clone = (list) => list.map((b) => ({ ...JSON.parse(JSON.stringify(b)), id: uid() }));

  function refocusAround(p, index) {
    const target = p.blocks[Math.max(0, Math.min(index, p.blocks.length - 1))];
    if (target) focusBlock(target.id, index > 0 ? 'end' : 0);
  }

  function remove() {
    const p = pg();
    const del = new Set(blocks().map((b) => b.id));
    if (!del.size) return;
    const first = p.blocks.findIndex((b) => del.has(b.id));
    p.blocks = p.blocks.filter((b) => !del.has(b.id));
    if (!p.blocks.length) p.blocks.push({ id: uid(), type: 'p', text: '', indent: 0 });
    clear();
    touch(p);
    renderBlocks();
    refocusAround(p, first - 1);
  }

  function replaceWith(newBlocks) {
    const p = pg();
    const del = new Set(blocks().map((b) => b.id));
    const first = p.blocks.findIndex((b) => del.has(b.id));
    if (first < 0) return;
    p.blocks = p.blocks.filter((b) => !del.has(b.id));
    const ins = newBlocks.length ? newBlocks : [{ id: uid(), type: 'p', text: '', indent: 0 }];
    p.blocks.splice(first, 0, ...ins);
    clear();
    touch(p);
    renderBlocks();
    focusBlock(ins[ins.length - 1].id, 'end');
  }

  function duplicate() {
    const p = pg();
    const list = blocks();
    if (!list.length) return;
    const copies = clone(list);
    const last = p.blocks.indexOf(list[list.length - 1]);
    p.blocks.splice(last + 1, 0, ...copies);
    touch(p);
    renderBlocks();
    const top = copies.filter((c, i) => !list[i] || ids.has(list[i].id)).map((c) => c.id);
    set(top, top[0], top[top.length - 1]);
  }

  function indent(dir) {
    const p = pg();
    const list = blocks();
    if (!list.length) return;
    if (dir > 0) {
      const firstIdx = p.blocks.indexOf(list[0]);
      const prev = p.blocks[firstIdx - 1];
      if (!prev || (list[0].indent || 0) > (prev.indent || 0) || list.some((b) => (b.indent || 0) >= 8)) return;
    } else if (list.every((b) => !(b.indent || 0))) return;
    list.forEach((b) => { b.indent = Math.max(0, (b.indent || 0) + dir); });
    touch(p);
    renderBlocks();
  }

  function turnAll(type) {
    const p = pg();
    blocks().forEach((b) => { if (TEXT_TYPES.includes(b.type) && b.type !== type) setType(b, type); });
    touch(p);
    renderBlocks();
  }

  function markdown() { return mdOfBlocks(blocks()); }

  function writeClipboard(e) {
    const list = blocks();
    e.clipboardData.setData('text/plain', mdOfBlocks(list));
    try { e.clipboardData.setData(MIME, JSON.stringify(list)); } catch (err) { /* type non pris en charge */ }
  }

  // Blocs copiés depuis ReNotion (format exact), sinon null
  function readClipboard(dt) {
    try {
      const raw = dt.getData(MIME);
      if (!raw) return null;
      const list = JSON.parse(raw);
      return Array.isArray(list) && list.length ? clone(list) : null;
    } catch (e) { return null; }
  }

  function menuItems() {
    const n = blocks().length;
    const items = [
      { header: `${ids.size} bloc${ids.size > 1 ? 's' : ''} sélectionné${ids.size > 1 ? 's' : ''}` },
      { icon: '🗑', label: 'Supprimer', right: 'Suppr', danger: true, action: remove },
      { icon: '⧉', label: 'Dupliquer', right: 'Ctrl+D', action: duplicate },
      { icon: '📋', label: 'Copier', right: 'Ctrl+C', action: () => navigator.clipboard.writeText(markdown()).then(() => toast(`${n} bloc${n > 1 ? 's' : ''} copié${n > 1 ? 's' : ''}`)) },
      { icon: '✨', label: 'Demander à l’IA', right: 'Ctrl+J', action: () => AI.open(null) },
      { icon: '→', label: 'Indenter', right: 'Tab', action: () => indent(1) },
      { icon: '←', label: 'Désindenter', right: 'Maj+Tab', action: () => indent(-1) },
      '-', { header: 'Transformer en' },
    ];
    TEXT_TYPES.forEach((t) => items.push({ icon: TYPES[t].icon, label: TYPES[t].label, action: () => turnAll(t) }));
    return items;
  }

  /* ---------- Clavier ---------- */

  const editableTarget = (t) => t && t.closest && t.closest('input, textarea, select, .modal, #ai, .pop');

  function textFullySelected(el) {
    const sel = getSelection();
    if (!el.textContent.length) return true;
    if (!sel.rangeCount || sel.isCollapsed) return false;
    return sel.toString().length >= el.textContent.length;
  }

  document.addEventListener('keydown', (e) => {
    if (!current || isFolder(S.pages[current]) || editableTarget(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;

    if (!ids.size) {
      // Ctrl+A : d'abord le texte du bloc, puis toute la page
      if (mod && key.toLowerCase() === 'a' && !e.shiftKey) {
        const el = e.target.closest && e.target.closest('.content[contenteditable], .cell, .page-title');
        if (!el || textFullySelected(el)) { e.preventDefault(); e.stopPropagation(); selectAll(); }
        return;
      }
      // Maj+↑ au début d'un bloc / Maj+↓ à la fin : passe en sélection de blocs
      if (e.shiftKey && !mod && (key === 'ArrowUp' || key === 'ArrowDown')) {
        const c = e.target.closest && e.target.closest('.content[contenteditable]');
        const row = c && c.closest('.block');
        if (!row) return;
        const off = caretOffset(c);
        const atEdge = key === 'ArrowUp' ? off === 0 || onFirstLine(c) && getSelection().toString().length === c.textContent.length : off === c.textContent.length;
        if (!atEdge) return;
        const v = visibleIds();
        const i = v.indexOf(row.dataset.id);
        const j = key === 'ArrowUp' ? i - 1 : i + 1;
        e.preventDefault();
        e.stopPropagation();
        dropTextFocus();
        if (j < 0 || j >= v.length) set([v[i]], v[i], v[i]);
        else set(range(v[i], v[j]), v[i], v[j]);
      }
      return;
    }

    // Une sélection de blocs est active
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (key === 'Escape') { stop(); clear(); return; }
    if (key === 'Backspace' || key === 'Delete') { stop(); remove(); return; }
    if (mod && key.toLowerCase() === 'a') { stop(); selectAll(); return; }
    if (mod && key.toLowerCase() === 'd') { stop(); duplicate(); return; }
    if (key === 'Tab') { stop(); indent(e.shiftKey ? -1 : 1); return; }
    if (e.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      stop();
      const v = visibleIds();
      const hi = v.indexOf(head || anchor);
      const next = v[Math.max(0, Math.min(v.length - 1, hi + (key === 'ArrowUp' ? -1 : 1)))];
      set(range(anchor || next, next), anchor || next, next);
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'Enter') {
      stop();
      const list = visibleIds().filter((id) => ids.has(id));
      const target = key === 'ArrowUp' ? list[0] : list[list.length - 1];
      clear();
      focusBlock(target, key === 'ArrowUp' ? 0 : 'end');
      return;
    }
    if (mod && (key.toLowerCase() === 'z' || key.toLowerCase() === 'y')) { clear(); return; } // Annuler reste géré ailleurs
    if (mod) return; // Ctrl+C / X / V / J… : gérés par les événements ou l'app
    if (key.length === 1) { stop(); clear(); }
  }, true);

  /* ---------- Presse-papiers ---------- */

  document.addEventListener('copy', (e) => {
    if (!ids.size || editableTarget(e.target)) return;
    e.preventDefault();
    writeClipboard(e);
    const n = blocks().length;
    toast(`${n} bloc${n > 1 ? 's' : ''} copié${n > 1 ? 's' : ''}`);
  });
  document.addEventListener('cut', (e) => {
    if (!ids.size || editableTarget(e.target)) return;
    e.preventDefault();
    writeClipboard(e);
    remove();
  });
  document.addEventListener('paste', (e) => {
    if (!ids.size || editableTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const exact = readClipboard(e.clipboardData);
    const text = (e.clipboardData.getData('text/plain') || '').replace(/\r\n?/g, '\n');
    replaceWith(exact || mdToBlocks(text));
  }, true);

  /* ---------- Souris ---------- */

  const NO_BAND = '.page-head, .handle, button, a, input, .pop, .modal, .media-tools, .tbl-add, .cover, iframe, .add-below, .folder-view';

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const pageEl = $('#page');
    if (!pageEl || !pageEl.contains(e.target) || !$('#blocks')) {
      if (!e.target.closest('.pop, .modal-back')) clear();
      return;
    }
    if (e.target.closest('.handle') && ids.has(e.target.closest('.block').dataset.id)) return; // menu de la sélection
    const row = e.target.closest('#blocks > .block');

    // Maj+clic : plage depuis le bloc actif (ou l'ancre)
    if (e.shiftKey && row) {
      const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('#blocks > .block');
      const from = anchor || (focused && focused.dataset.id);
      if (from && from !== row.dataset.id) {
        e.preventDefault();
        dropTextFocus();
        set(range(from, row.dataset.id), from, row.dataset.id);
        return;
      }
    }

    clear();
    if (row && !e.target.closest('.handle')) {
      drag = { mode: 'text', startId: row.dataset.id, startY: e.clientY };
    } else if (!row && !e.target.closest(NO_BAND)) {
      // départ dans la marge : sélection rectangulaire
      e.preventDefault();
      dropTextFocus();
      drag = { mode: 'band', startY: e.clientY, startX: e.clientX, scroll: $('#scroller').scrollTop };
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    if (!(e.buttons & 1)) { endDrag(); return; }
    if (drag.mode === 'band') {
      const sc = $('#scroller');
      const y0 = drag.startY - (sc.scrollTop - drag.scroll);
      const top = Math.min(y0, e.clientY);
      const bottom = Math.max(y0, e.clientY);
      if (bottom - top < 4) return;
      if (!band) { band = h('div', { class: 'select-band' }); document.body.append(band); }
      Object.assign(band.style, { top: top + 'px', height: bottom - top + 'px', left: Math.min(drag.startX, e.clientX) + 'px', width: Math.abs(e.clientX - drag.startX) + 'px' });
      const hit = rows().filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > top && b.top < bottom; }).map((r) => r.dataset.id);
      set(hit, hit[0] || null, hit[hit.length - 1] || null);
      autoScroll(e.clientY);
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el && el.closest && el.closest('#blocks > .block');
    if (!row) return;
    if (drag.mode === 'text' && row.dataset.id !== drag.startId) {
      drag.mode = 'blocks';
      document.body.classList.add('selecting-blocks');
      dropTextFocus();
    }
    if (drag.mode === 'blocks') {
      e.preventDefault();
      set(range(drag.startId, row.dataset.id), drag.startId, row.dataset.id);
      autoScroll(e.clientY);
    }
  });

  function autoScroll(y) {
    const sc = $('#scroller');
    const r = sc.getBoundingClientRect();
    if (y < r.top + 40) sc.scrollTop -= 14;
    else if (y > r.bottom - 40) sc.scrollTop += 14;
  }

  function endDrag() {
    drag = null;
    document.body.classList.remove('selecting-blocks');
    if (band) { band.remove(); band = null; }
  }
  document.addEventListener('mouseup', endDrag);

  return { paint, clear, size, includes, blocks, markdown, menuItems, remove, replaceWith, readClipboard, selectAll };
})();
