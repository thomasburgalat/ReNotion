'use strict';

/* Bloc tableau : cellules éditables, lignes/colonnes, en-têtes, Markdown, fusion collaborative. */

const Table = (() => {
  const blank = (r, c) => Array.from({ length: r }, () => Array.from({ length: c }, () => ''));
  const cols = (b) => Math.max(1, ...b.rows.map((r) => r.length));

  function ensure(b) {
    if (!Array.isArray(b.rows) || !b.rows.length) b.rows = blank(3, 3);
    const n = cols(b);
    b.rows = b.rows.map((r) => { const row = (Array.isArray(r) ? r : []).map((x) => String(x == null ? '' : x)); while (row.length < n) row.push(''); return row; });
    if (b.headerRow === undefined) b.headerRow = true;
    return b;
  }

  function create(b, firstCell) {
    b.rows = blank(3, 3);
    if (firstCell) b.rows[0][0] = firstCell;
    b.headerRow = true;
    b.headerCol = false;
    b.text = '';
    return b;
  }

  /* ---------- Rendu ---------- */

  function render(b) {
    ensure(b);
    const table = h('table', { class: 'tbl' });
    b.rows.forEach((row, r) => {
      const tr = h('tr');
      row.forEach((html, c) => {
        const head = (b.headerRow && r === 0) || (b.headerCol && c === 0);
        const cell = h('div', { class: 'cell', contenteditable: 'true', spellcheck: 'true', 'data-r': r, 'data-c': c });
        cell.innerHTML = sanitize(html);
        tr.append(h(head ? 'th' : 'td', {}, cell));
      });
      table.append(tr);
    });
    return h('div', { class: 'content tbl-wrap' },
      h('div', { class: 'tbl-scroll' }, table),
      h('button', { class: 'tbl-add tbl-add-row', 'data-act': 'tbl-row', title: 'Ajouter une ligne' }, '＋'),
      h('button', { class: 'tbl-add tbl-add-col', 'data-act': 'tbl-col', title: 'Ajouter une colonne' }, '＋'));
  }

  const cellEl = (id, r, c) => document.querySelector(`.block[data-id="${id}"] .cell[data-r="${r}"][data-c="${c}"]`);

  function focusCell(id, r, c, pos = 'end') {
    const el = cellEl(id, r, c);
    if (el) setCaret(el, pos);
    return !!el;
  }

  function focus(b, pos) {
    ensure(b);
    if (pos === 'end') focusCell(b.id, b.rows.length - 1, cols(b) - 1, 'end');
    else focusCell(b.id, 0, 0, 0);
  }

  // Mémorise/restaure la cellule active autour d'un nouveau rendu
  function saveFocus() {
    const el = document.activeElement;
    if (!el || !el.classList || !el.classList.contains('cell')) return null;
    const row = el.closest('.block');
    return row && { id: row.dataset.id, r: +el.dataset.r, c: +el.dataset.c, off: caretOffset(el) };
  }
  function restoreFocus(f) {
    if (f && !focusCell(f.id, f.r, f.c, f.off < 0 ? 'end' : f.off)) focus(blk(f.id) || { id: f.id, rows: [['']] }, 'end');
  }

  function rerender(b, f) {
    touch(pg());
    renderBlocks();
    if (f) restoreFocus(f);
  }

  /* ---------- Opérations ---------- */

  function addRow(b, at) { ensure(b); b.rows.splice(at, 0, Array(cols(b)).fill('')); }
  function addCol(b, at) { ensure(b); b.rows.forEach((r) => r.splice(at, 0, '')); }
  function delRow(b, r) { if (b.rows.length > 1) b.rows.splice(r, 1); }
  function delCol(b, c) { if (cols(b) > 1) b.rows.forEach((row) => row.splice(c, 1)); }

  function cellMenu(b, r, c) {
    const keep = (fr, fc) => ({ id: b.id, r: fr, c: fc, off: 0 });
    return [
      { header: 'Tableau' },
      { icon: '↥', label: 'Insérer une ligne au-dessus', action: () => { addRow(b, r); rerender(b, keep(r, c)); } },
      { icon: '↧', label: 'Insérer une ligne en dessous', action: () => { addRow(b, r + 1); rerender(b, keep(r + 1, c)); } },
      { icon: '↤', label: 'Insérer une colonne à gauche', action: () => { addCol(b, c); rerender(b, keep(r, c)); } },
      { icon: '↦', label: 'Insérer une colonne à droite', action: () => { addCol(b, c + 1); rerender(b, keep(r, c + 1)); } },
      { icon: '⇅', label: 'Trier selon cette colonne', action: () => { sortBy(b, c); rerender(b, keep(r, c)); } },
      { icon: '▤', label: b.headerRow ? 'Retirer l’en-tête de ligne' : 'Première ligne en en-tête', action: () => { b.headerRow = !b.headerRow; rerender(b, keep(r, c)); } },
      { icon: '▥', label: b.headerCol ? 'Retirer l’en-tête de colonne' : 'Première colonne en en-tête', action: () => { b.headerCol = !b.headerCol; rerender(b, keep(r, c)); } },
      '-',
      { icon: '🗑', label: 'Supprimer la ligne', danger: true, action: () => { delRow(b, r); rerender(b, keep(Math.min(r, b.rows.length - 1), c)); } },
      { icon: '🗑', label: 'Supprimer la colonne', danger: true, action: () => { delCol(b, c); rerender(b, keep(r, Math.min(c, cols(b) - 1))); } },
    ];
  }

  function sortBy(b, c) {
    const start = b.headerRow ? 1 : 0;
    const body = b.rows.slice(start);
    const key = (row) => plain(row[c] || '').trim();
    const allNum = body.every((row) => !key(row) || !isNaN(parseFloat(key(row).replace(',', '.'))));
    body.sort((x, y) => {
      const a = key(x); const z = key(y);
      if (!a) return 1;
      if (!z) return -1;
      return allNum ? parseFloat(a.replace(',', '.')) - parseFloat(z.replace(',', '.')) : a.localeCompare(z, 'fr', { numeric: true });
    });
    b.rows = b.rows.slice(0, start).concat(body);
  }

  /* ---------- Événements ---------- */

  function onInput(b, cell) {
    ensure(b);
    const r = +cell.dataset.r; const c = +cell.dataset.c;
    if (b.rows[r]) b.rows[r][c] = cell.innerHTML.replace(/^<br>$/, '');
    touch(pg());
  }

  function onKey(e, b, cell) {
    ensure(b);
    const r = +cell.dataset.r; const c = +cell.dataset.c;
    const nr = b.rows.length; const nc = cols(b);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); wrapCellCode(b, cell); return true; }
    if (e.key === 'Tab') {
      e.preventDefault();
      let i = r * nc + c + (e.shiftKey ? -1 : 1);
      if (i < 0) return true;
      if (i >= nr * nc) { addRow(b, nr); rerender(b, { id: b.id, r: nr, c: 0, off: 0 }); return true; }
      focusCell(b.id, Math.floor(i / nc), i % nc, 'end');
      return true;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (mod) {
        const nb = insertAfter(b.id, { id: uid(), type: 'p', text: '', indent: b.indent || 0 });
        renderBlocks(); focusBlock(nb.id, 0); return true;
      }
      if (r + 1 >= nr) { addRow(b, nr); rerender(b, { id: b.id, r: nr, c, off: 0 }); }
      else focusCell(b.id, r + 1, c, 'end');
      return true;
    }
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); return true; }
    if (e.key === 'ArrowUp' && !e.shiftKey && onFirstLine(cell)) {
      e.preventDefault();
      if (r > 0) focusCell(b.id, r - 1, c, 'end');
      else { const pv = prevVisible(b.id); if (pv) focusBlock(pv.id, 'end'); else setCaret($('.page-title'), 'end'); }
      return true;
    }
    if (e.key === 'ArrowDown' && !e.shiftKey && onLastLine(cell)) {
      e.preventDefault();
      if (r + 1 < nr) focusCell(b.id, r + 1, c, 0);
      else {
        let nx = nextVisible(b.id);
        if (!nx) { nx = insertAfter(b.id, { id: uid(), type: 'p', text: '', indent: b.indent || 0 }); renderBlocks(); }
        focusBlock(nx.id, 0);
      }
      return true;
    }
    const sel = getSelection();
    const off = caretOffset(cell);
    if (e.key === 'ArrowLeft' && sel.isCollapsed && off === 0 && (r || c)) {
      e.preventDefault(); const i = r * nc + c - 1; focusCell(b.id, Math.floor(i / nc), i % nc, 'end'); return true;
    }
    if (e.key === 'ArrowRight' && sel.isCollapsed && off === cell.textContent.length && r * nc + c + 1 < nr * nc) {
      e.preventDefault(); const i = r * nc + c + 1; focusCell(b.id, Math.floor(i / nc), i % nc, 0); return true;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && sel.isCollapsed && !cell.textContent.length) {
      e.preventDefault(); // une cellule vide ne fusionne jamais avec le bloc voisin
      if (e.key === 'Backspace' && (r || c)) { const i = r * nc + c - 1; focusCell(b.id, Math.floor(i / nc), i % nc, 'end'); }
      return true;
    }
    if (e.key === 'Escape') { e.preventDefault(); cell.closest('.block').focus(); return true; }
    return false; // le reste (Ctrl+B/I/U, frappe…) suit le comportement par défaut
  }

  function wrapCellCode(b, cell) {
    const sel = getSelection();
    if (sel.isCollapsed) return;
    const rng = sel.getRangeAt(0);
    const el = document.createElement('code');
    el.append(rng.extractContents());
    rng.insertNode(el);
    onInput(b, cell);
  }

  // Coller : texte simple dans la cellule, ou grille (tabulations / tableau Markdown) répartie dans les cellules
  function onPaste(e, b, cell) {
    e.preventDefault();
    const text = (e.clipboardData.getData('text/plain') || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    let grid = null;
    const lines = text.split('\n');
    if (lines.length > 1 && lines.every((l) => /^\s*\|.*\|\s*$/.test(l))) grid = parseMd(lines).rows;
    else if (/\t/.test(text) || lines.length > 1) grid = lines.map((l) => l.split('\t').map((x) => inlineMd(x.trim())));
    if (!grid || (grid.length === 1 && grid[0].length === 1)) { document.execCommand('insertText', false, text.replace(/\n/g, ' ')); return; }
    ensure(b);
    const r0 = +cell.dataset.r; const c0 = +cell.dataset.c;
    grid.forEach((row, i) => row.forEach((val, j) => {
      while (b.rows.length <= r0 + i) addRow(b, b.rows.length);
      while (cols(b) <= c0 + j) addCol(b, cols(b));
      b.rows[r0 + i][c0 + j] = val;
    }));
    rerender(b, { id: b.id, r: r0 + grid.length - 1, c: c0 + grid[grid.length - 1].length - 1, off: -1 });
  }

  function onAction(act, b) {
    ensure(b);
    if (act === 'tbl-row') { addRow(b, b.rows.length); rerender(b, { id: b.id, r: b.rows.length - 1, c: 0, off: 0 }); return true; }
    if (act === 'tbl-col') { addCol(b, cols(b)); rerender(b, { id: b.id, r: 0, c: cols(b) - 1, off: 0 }); return true; }
    return false;
  }

  /* ---------- Markdown ---------- */

  const cellMd = (html) => htmlToMd(html).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
  function toMd(b) {
    ensure(b);
    const n = cols(b);
    const line = (row) => '| ' + row.map(cellMd).join(' | ') + ' |';
    return [line(b.rows[0]), '| ' + Array(n).fill('---').join(' | ') + ' |', ...b.rows.slice(1).map(line)].join('\n');
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const out = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; } else if (s[i] === '|') { out.push(cur); cur = ''; } else cur += s[i];
    }
    out.push(cur);
    return out.map((x) => x.trim());
  }
  const isSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

  function parseMd(lines) {
    const hasSep = lines.length > 1 && isSep(lines[1]);
    const rows = lines.filter((l, i) => !(hasSep && i === 1) && !isSep(l)).map((l) => splitRow(l).map((x) => inlineMd(x.replace(/<br\s*\/?>/gi, ' '))));
    const n = Math.max(1, ...rows.map((r) => r.length));
    rows.forEach((r) => { while (r.length < n) r.push(''); });
    return { id: uid(), type: 'table', text: '', indent: 0, rows: rows.length ? rows : blank(1, n), headerRow: hasSep, headerCol: false };
  }

  const plainText = (b) => (b.rows || []).map((r) => r.map((x) => plain(x)).filter(Boolean).join(' · ')).filter(Boolean).join(' · ');

  /* ---------- Fusion collaborative (cellule par cellule) ---------- */

  // base = dernier état synchronisé, local = état actuel, remote = état reçu
  function merge(base, local, remote) {
    const same = (a, z) => a && z && a.length === z.length && a.every((r, i) => r.length === z[i].length);
    if (!same(base, local) || !same(local, remote)) return null; // structure modifiée des deux côtés : pas de fusion fine
    return remote.map((row, i) => row.map((val, j) => (local[i][j] !== base[i][j] ? local[i][j] : val)));
  }

  return { create, render, focus, focusCell, saveFocus, restoreFocus, onInput, onKey, onPaste, onAction, cellMenu, toMd, parseMd, plainText, merge, ensure };
})();
