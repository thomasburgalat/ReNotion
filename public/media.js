'use strict';

/* Médias : images et fichiers (PDF…) dans les pages. En ligne : Supabase Storage (privé, URL signées). En local : data URL. */

const Media = (() => {
  const MAX = 25 * 1024 * 1024;
  const LOCAL_MAX = 3 * 1024 * 1024;
  const IMAGE = /^image\/(png|jpe?g|gif|webp|avif)$/;
  const PDFJS = 'vendor/pdfjs-6.3.289/';
  const urls = new Map(); // path -> { url, exp }
  const waiting = new Map(); // path -> [resolve]
  let batchTimer = null;

  const isMedia = (b) => b && (b.type === 'image' || b.type === 'file');
  const kindOf = (file) => (IMAGE.test(file.type) ? 'image' : 'file');
  const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko');

  /* ---------- URL signées (regroupées) ---------- */

  function resolve(path) {
    const hit = urls.get(path);
    if (hit && hit.exp > Date.now() + 60000) return Promise.resolve(hit.url);
    return new Promise((ok) => {
      if (!waiting.has(path)) waiting.set(path, []);
      waiting.get(path).push(ok);
      clearTimeout(batchTimer);
      batchTimer = setTimeout(flushBatch, 20);
    });
  }

  async function flushBatch() {
    const paths = [...waiting.keys()];
    const cbs = new Map(waiting);
    waiting.clear();
    let res = {};
    try { res = await Cloud.signMedia(paths); } catch (e) { console.error('media', e); }
    for (const p of paths) {
      const url = res[p] || null;
      if (url) urls.set(p, { url, exp: Date.now() + 3500 * 1000 });
      cbs.get(p).forEach((ok) => ok(url));
    }
  }

  const srcOf = (b) => (b.src ? Promise.resolve(b.src) : b.path ? resolve(b.path) : Promise.resolve(b._blob || null));

  // Remplit les <img>, <iframe>, liens qui attendent une URL
  function hydrate(root) {
    if (!root) return;
    root.querySelectorAll('[data-media]').forEach((el) => {
      const b = { path: el.dataset.path || '', src: el.dataset.src || '', _blob: el.dataset.blob || '' };
      srcOf(b).then((url) => {
        if (!url) { el.classList.add('media-missing'); return; }
        if (el.tagName === 'A') el.href = url;
        else el.src = url;
      });
    });
  }

  /* ---------- Rendu ---------- */

  function render(b) {
    const ref = { 'data-media': '1', 'data-path': b.path || null, 'data-src': b.src || null, 'data-blob': !b.path && !b.src ? b._blob || null : null };
    const ready = b.path || b.src;
    const box = h('div', { class: 'content media-box' });
    if (b.type === 'image') {
      box.append(h('figure', { class: 'media-img', style: { width: (b.width || 100) + '%' } },
        ready || b._blob ? h('img', { ...ref, alt: b.name || 'Image', loading: 'lazy', draggable: 'false' }) : h('div', { class: 'media-wait' }, '⏳ Envoi de l’image…'),
        b._uploading ? h('div', { class: 'media-progress' }, 'Envoi…') : null,
        b._error ? h('div', { class: 'media-error' }, '⚠️ ' + b._error) : null));
    } else {
      const pdf = (b.mime || '').includes('pdf') || /\.pdf$/i.test(b.name || '');
      box.append(h('div', { class: 'media-file' },
        h('span', { class: 'media-ico' }, pdf ? '📕' : '📎'),
        h('span', { class: 'media-name' }, b.name || 'Fichier'),
        h('span', { class: 'muted' }, b.size ? fmtSize(b.size) : ''),
        b._uploading ? h('span', { class: 'muted' }, '· envoi…') : null,
        b._error ? h('span', { class: 'media-error' }, '⚠️ ' + b._error) : null,
        ready ? h('a', { ...ref, class: 'chip', target: '_blank', rel: 'noopener', download: b.name || 'fichier', 'data-act': 'media-open' }, 'Ouvrir') : null));
      if (pdf && ready && b.preview !== false) box.append(h('iframe', { ...ref, class: 'media-pdf', title: b.name || 'PDF' }));
    }
    const tools = h('div', { class: 'media-tools' });
    if (b.type === 'image' && ready) {
      tools.append(
        h('button', { class: 'chip', 'data-act': 'media-width', title: 'Changer la taille' }, '↔ ' + (b.width || 100) + ' %'),
        h('a', { ...ref, class: 'chip', target: '_blank', rel: 'noopener', 'data-act': 'media-open' }, 'Ouvrir'));
    }
    if (b.type === 'file' && ready && ((b.mime || '').includes('pdf') || /\.pdf$/i.test(b.name || ''))) {
      tools.append(
        h('button', { class: 'chip', 'data-act': 'media-preview' }, b.preview === false ? 'Afficher l’aperçu' : 'Masquer l’aperçu'),
        h('button', { class: 'chip', 'data-act': 'media-text', title: 'Insère le texte du PDF sous ce bloc (lisible aussi par l’IA)' }, 'Extraire le texte'));
    }
    const bar = box.querySelector('.media-file');
    if (bar) bar.insertBefore(tools, bar.querySelector('a.chip')); else box.append(tools);
    return box;
  }

  function onAction(act, b) {
    const p = pg();
    switch (act) {
      case 'media-width': {
        const steps = [100, 75, 50, 33];
        b.width = steps[(steps.indexOf(b.width || 100) + 1) % steps.length];
        touch(p); renderBlocks(); focusBlock(b.id); return true;
      }
      case 'media-preview':
        b.preview = b.preview === false; touch(p); renderBlocks(); return true;
      case 'media-text':
        extractPdf(b); return true;
      case 'media-open':
        return false; // lien normal
    }
    return false;
  }

  /* ---------- Envoi ---------- */

  async function upload(file) {
    if (CLOUD) return { path: await Cloud.uploadMedia(file) };
    if (file.size > LOCAL_MAX) throw new Error('En mode local, 3 Mo maximum par fichier');
    return { src: await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ko(r.error); r.readAsDataURL(file); }) };
  }

  // Insère des fichiers sous le bloc donné (ou remplace ce bloc s'il est vide)
  function insertFiles(files, afterId, opts = {}) {
    const p = pg();
    if (!p || isFolder(p)) return [];
    const list = [...files].filter((f) => f && f.size);
    if (!list.length) return [];
    const ok = list.filter((f) => {
      if (f.size > MAX) { toast(`« ${f.name} » dépasse 25 Mo`); return false; }
      if (kindOf(f) === 'file' && f.type !== 'application/pdf') { toast(`« ${f.name} » : seuls les images et les PDF sont acceptés`); return false; }
      return true;
    });
    if (!ok.length) return [];
    let i = afterId ? p.blocks.findIndex((x) => x.id === afterId) : p.blocks.length - 1;
    const ref = p.blocks[i];
    const replace = ref && ref.type === 'p' && !plain(ref.text).trim() && opts.replaceEmpty !== false;
    const created = ok.map((f) => ({
      id: uid(), type: kindOf(f), text: '', indent: ref ? ref.indent || 0 : 0,
      name: f.name || (kindOf(f) === 'image' ? 'image.png' : 'fichier'), size: f.size, mime: f.type,
      _uploading: true, _blob: kindOf(f) === 'image' ? URL.createObjectURL(f) : '',
    }));
    if (replace) p.blocks.splice(i, 1, ...created);
    else p.blocks.splice(i + 1, 0, ...created);
    if (!p.blocks.some((x, k) => k > p.blocks.indexOf(created[created.length - 1]))) p.blocks.push({ id: uid(), type: 'p', text: '', indent: 0 });
    renderBlocks();
    created.forEach((b, k) => {
      upload(ok[k]).then((res) => {
        Object.assign(b, res);
        delete b._uploading;
        touch(p);
        if (p.id === current) renderBlocks();
        if (opts.onDone) opts.onDone(b);
      }).catch((err) => {
        console.error(err);
        b._error = err.message || 'Échec de l’envoi';
        delete b._uploading;
        if (p.id === current) renderBlocks();
        toast('Envoi impossible : ' + b._error);
      });
    });
    focusBlock(created[created.length - 1].id);
    return created;
  }

  function pick(kind, afterId, opts) {
    const inp = h('input', { type: 'file', accept: kind === 'image' ? 'image/png,image/jpeg,image/gif,image/webp,image/avif' : 'application/pdf,image/*', multiple: true });
    inp.addEventListener('change', () => insertFiles(inp.files, afterId, opts));
    inp.click();
  }

  /* ---------- PDF → texte ---------- */

  let pdfjs = null;
  async function loadPdfjs() {
    if (!pdfjs) {
      pdfjs = await import(new URL(PDFJS + 'pdf.min.mjs', location.href).href);
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(PDFJS + 'pdf.worker.min.mjs', location.href).href;
    }
    return pdfjs;
  }

  async function pdfToBlocks(source) {
    const lib = await loadPdfjs();
    const doc = await lib.getDocument(source).promise;
    const out = [];
    for (let n = 1; n <= doc.numPages && out.length < 3000; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      let line = '';
      const lines = [];
      for (const it of tc.items) {
        line += it.str;
        if (it.hasEOL) { lines.push(line); line = ''; }
      }
      if (line) lines.push(line);
      // regroupe les lignes en paragraphes
      const paras = [];
      let cur = '';
      for (const l of lines) {
        const t = l.replace(/\s+/g, ' ').trim();
        if (!t) { if (cur) { paras.push(cur); cur = ''; } continue; }
        cur = cur ? (/-$/.test(cur) ? cur.slice(0, -1) + t : cur + ' ' + t) : t;
        if (/[.!?:;»”]$/.test(t) && cur.length > 200) { paras.push(cur); cur = ''; }
      }
      if (cur) paras.push(cur);
      if (doc.numPages > 1 && paras.length) out.push({ id: uid(), type: 'h3', text: esc('Page ' + n), indent: 0 });
      paras.forEach((t) => out.push({ id: uid(), type: 'p', text: esc(t), indent: 0 }));
    }
    return { blocks: out, pages: doc.numPages };
  }

  async function extractPdf(b) {
    const p = pg();
    toast('Lecture du PDF…');
    try {
      const url = await srcOf(b);
      if (!url) throw new Error('fichier indisponible');
      const source = url.startsWith('data:') ? { data: Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0)) } : { url };
      const { blocks, pages } = await pdfToBlocks(source);
      if (!blocks.length) { toast('Aucun texte trouvé (PDF scanné ?)'); return; }
      const i = p.blocks.findIndex((x) => x.id === b.id);
      p.blocks.splice(i + 1, 0, ...blocks);
      touch(p);
      if (p.id === current) renderBlocks();
      toast(`Texte extrait : ${pages} page${pages > 1 ? 's' : ''}, ${blocks.length} blocs`);
    } catch (err) {
      console.error(err);
      toast('Extraction impossible : ' + err.message);
    }
  }

  // Paramètres → Importer un PDF : nouvelle page avec le fichier et son texte
  function importPdf() {
    const inp = h('input', { type: 'file', accept: 'application/pdf' });
    inp.addEventListener('change', () => {
      const f = inp.files[0];
      if (!f) return;
      const pnew = newPage(null, f.name.replace(/\.pdf$/i, ''));
      pnew.icon = '📕';
      go(pnew.id);
      insertFiles([f], pnew.blocks[0].id, { onDone: (b) => extractPdf(b) });
    });
    inp.click();
  }

  /* ---------- Collage & glisser-déposer ---------- */

  const filesOf = (dt) => [...(dt && dt.files ? dt.files : [])].filter((f) => f.size);
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');

  function bindDrop(area) {
    const clear = () => document.querySelectorAll('.file-drop-before, .file-drop-after').forEach((x) => x.classList.remove('file-drop-before', 'file-drop-after'));
    area.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      clear();
      const row = e.target.closest('.block');
      if (row) row.classList.add('file-drop-after');
      else area.classList.add('file-drop-after');
    });
    area.addEventListener('dragleave', (e) => { if (!area.contains(e.relatedTarget)) clear(); });
    area.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const row = e.target.closest('.block');
      clear();
      insertFiles(filesOf(e.dataTransfer), row ? row.dataset.id : null, { replaceEmpty: !!row });
    });
  }

  return { isMedia, render, hydrate, onAction, insertFiles, pick, importPdf, bindDrop, filesOf, fmtSize };
})();
