'use strict';

/* ReNotion — espace de notes par blocs, 100 % local (localStorage). */

const LS_KEY = 'renotion:v1';
const LS_UI = 'renotion:ui';

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

/* ---------- Types de blocs ---------- */

const TYPES = {
  ai: { group: 'IA', label: 'Demander à l’IA', desc: 'Rédiger, résumer, traduire, brainstormer…', icon: '✨', keys: 'ia ai intelligence artificielle assistant ecrire' },
  askspace: { group: 'IA', label: 'Demander à tout l’espace', desc: 'Une question ? L’IA répond à partir de toutes vos pages.', icon: '🔎', keys: 'ia ai question espace recherche demander chercher' },
  mistral: { group: 'Mistral', label: 'Demander à Mistral', desc: 'Écrire, résumer, traduire avec Mistral.', icon: 'Ⓜ', keys: 'mistral ia ai le chat' },
  think: { group: 'Mistral', label: 'IA Réflexion (Magistral)', desc: 'Raisonne en profondeur avant de répondre.', icon: '🧠', keys: 'reflexion raisonnement magistral mistral think penser ia ai' },
  template: { group: 'Avancé', label: 'Modèle de page…', desc: 'Réunion, projet, voyage, journal, recette…', icon: '🧩', keys: 'modele template gabarit' },
  toc: { group: 'Avancé', label: 'Sommaire', desc: 'Liste cliquable des titres de la page.', icon: '☰', keys: 'sommaire table des matieres toc plan' },
  dictate: { group: 'Avancé', label: 'Dicter', desc: 'Écris à la voix (micro).', icon: '🎙', keys: 'dicter dictee voix micro parler' },
  date: { group: 'Avancé', label: 'Date du jour', desc: 'Insère la date d’aujourd’hui.', icon: '📅', keys: 'date jour aujourdhui' },
  p: { label: 'Texte', desc: 'Commencez à écrire du texte simple.', icon: 'Aa', keys: 'texte text paragraphe paragraph' },
  h1: { label: 'Titre 1', desc: 'Grand titre de section.', icon: 'H1', keys: 'titre heading h1' },
  h2: { label: 'Titre 2', desc: 'Titre de section moyen.', icon: 'H2', keys: 'titre heading h2' },
  h3: { label: 'Titre 3', desc: 'Petit titre de section.', icon: 'H3', keys: 'titre heading h3' },
  todo: { label: 'Liste de tâches', desc: 'Suivez vos tâches avec des cases à cocher.', icon: '☑', keys: 'todo tache tâche checkbox case' },
  ul: { label: 'Liste à puces', desc: 'Une simple liste à puces.', icon: '•', keys: 'liste puces bullet ul' },
  ol: { label: 'Liste numérotée', desc: 'Une liste numérotée.', icon: '1.', keys: 'liste numerotee numérotée numbered ol' },
  toggle: { label: 'Liste dépliante', desc: 'Masquez ou affichez le contenu imbriqué.', icon: '▸', keys: 'toggle depliante dépliante' },
  quote: { label: 'Citation', desc: 'Capturez une citation.', icon: '❝', keys: 'citation quote' },
  callout: { label: 'Encadré', desc: 'Faites ressortir un texte.', icon: '💡', keys: 'encadre encadré callout note' },
  code: { label: 'Code', desc: 'Bloc de code.', icon: '</>', keys: 'code snippet' },
  image: { group: 'Médias', label: 'Image', desc: 'Ajoutez une photo (ou collez-la, ou glissez-la dans la page).', icon: '🖼', keys: 'image photo img media illustration' },
  file: { group: 'Médias', label: 'PDF / fichier', desc: 'Joignez un PDF avec aperçu intégré.', icon: '📕', keys: 'pdf fichier file document piece jointe' },
  table: { group: 'Avancé', label: 'Tableau', desc: 'Lignes et colonnes, comme dans un tableur.', icon: '▦', keys: 'tableau table grille tableur colonnes' },
  divider: { label: 'Séparateur', desc: 'Séparez visuellement les blocs.', icon: '—', keys: 'separateur séparateur divider ligne hr' },
  page: { label: 'Page', desc: 'Intégrez une sous-page.', icon: '📄', keys: 'page sous-page subpage' },
};
const PSEUDO_TYPES = new Set(['ai', 'askspace', 'mistral', 'think', 'template', 'dictate', 'date']);
const SLASH_GROUPS = ['IA', 'Mistral', 'Blocs de base', 'Médias', 'Avancé'];
const TEXT_TYPES = ['p', 'h1', 'h2', 'h3', 'todo', 'ul', 'ol', 'toggle', 'quote', 'callout', 'code'];
const CONTINUE_TYPES = ['todo', 'ul', 'ol'];
const PROP_KEYS = ['checked', 'collapsed', 'icon', 'lang', 'pageId', 'rows', 'headerRow', 'headerCol', 'path', 'src', 'name', 'size', 'mime', 'width', 'preview'];
const LIST_TYPES = ['todo', 'ul', 'ol', 'toggle'];
const PLACEHOLDER = { p: "Écrivez, ou tapez « / » pour les commandes…", h1: 'Titre 1', h2: 'Titre 2', h3: 'Titre 3', todo: 'À faire', ul: 'Liste', ol: 'Liste', toggle: 'Liste dépliante', quote: 'Citation vide', callout: 'Écrivez quelque chose…', code: '' };

const EMOJIS = '📄📝📓📒📕📗📘📙📚🗂📁📌📍📎✏️🖊🗒📅🗓📊📈💡⭐️🔥✅❤️🎯🚀🎨🎵🎬📷🏠🏢🌍✈️🍕☕️🍎🌱🌸🌙☀️⚡️🔑🔒🧠💼💰🛒🎁🏆⚽️🎮🐶🐱🦊🐼🦄🤖👋👀💬🧩🛠⚙️🧪📦🔖'.match(/\p{Extended_Pictographic}️?/gu);
const CALLOUT_ICONS = ['💡', '⚠️', '❗️', 'ℹ️', '✅', '🔥', '📌', '💬'];
const COVERS = [
  'linear-gradient(120deg,#f6d365,#fda085)', 'linear-gradient(120deg,#a1c4fd,#c2e9fb)', 'linear-gradient(120deg,#d4fc79,#96e6a1)',
  'linear-gradient(120deg,#fbc2eb,#a6c1ee)', 'linear-gradient(120deg,#84fab0,#8fd3f4)', 'linear-gradient(120deg,#ff9a9e,#fecfef)',
  'linear-gradient(120deg,#30cfd0,#330867)', 'linear-gradient(120deg,#434343,#000000)', '#e3e2e0', '#fbecdd', '#dbeddb', '#d3e5ef',
];

/* ---------- État & persistance ---------- */

let S;
let UI = { expanded: {}, sbHidden: false, theme: 'auto', wide: false, favs: {} };
const CLOUD = !!(window.RN_CONFIG && window.RN_CONFIG.supabaseUrl);
let current = null; // id de la page affichée

function newPage(parentId = null, title = '', kind = 'page') {
  const id = uid();
  const siblings = childrenOf(parentId);
  const p = {
    id, parentId, title, icon: '', cover: '', trashed: false, kind,
    pos: siblings.length ? siblings[siblings.length - 1].pos + 1 : 0,
    createdAt: Date.now(), updatedAt: Date.now(),
    blocks: kind === 'folder' ? [] : [{ id: uid(), type: 'p', text: '', indent: 0 }],
  };
  S.pages[id] = p;
  if (parentId) UI.expanded[parentId] = true;
  return p;
}

function seed() {
  S = { version: 1, pages: {} };
  seedPages();
  return S;
}

function seedPages() {
  const home = newPage(null, 'Bienvenue dans ReNotion');
  home.icon = '👋';
  home.cover = COVERS[1];
  const sub = newPage(home.id, 'Ma première sous-page');
  sub.icon = '🌱';
  sub.blocks = [{ id: uid(), type: 'p', text: 'Les pages peuvent s’imbriquer à l’infini.', indent: 0 }];
  const b = (type, text, extra = {}) => ({ id: uid(), type, text, indent: 0, ...extra });
  home.blocks = [
    b('p', 'Ton espace de notes perso, inspiré de Notion. Tout est enregistré <b>dans ce navigateur</b>.'),
    b('callout', 'Tape <code>/</code> dans un bloc vide pour ouvrir le menu des blocs.', { icon: '💡' }),
    b('h2', 'Raccourcis'),
    b('ul', '<code>#</code>, <code>##</code>, <code>###</code> + espace pour les titres'),
    b('ul', '<code>-</code> ou <code>*</code> + espace pour une liste, <code>1.</code> pour une liste numérotée'),
    b('ul', '<code>[]</code> pour une tâche, <code>&gt;</code> pour une liste dépliante, <code>"</code> pour une citation'),
    b('ul', '<code>```</code> pour du code, <code>---</code> pour un séparateur'),
    b('ul', '<b>Tab</b> / <b>Maj+Tab</b> pour indenter, <b>Ctrl+K</b> pour rechercher'),
    b('h2', 'À faire'),
    b('todo', 'Découvrir ReNotion', { checked: true }),
    b('todo', 'Créer ma première page'),
    b('todo', 'Exporter une sauvegarde depuis les paramètres'),
    b('toggle', 'Clique sur la flèche pour déplier', { collapsed: true }),
    { ...b('p', 'Contenu caché 🎉'), indent: 1 },
    b('divider', ''),
    b('page', '', { pageId: sub.id }),
  ];
  if (CLOUD) home.blocks[0].text = 'Votre espace partagé, inspiré de Notion. Les modifications apparaissent <b>en direct</b> chez tous les membres.';
  return home;
}

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.pages) S = d;
    }
  } catch (e) { /* stockage indisponible */ }
  loadUI();
  if (!S) seed();
  Object.values(S.pages).forEach((p) => { if (p.favorite) UI.favs[p.id] = true; delete p.favorite; });
}

let saveTimer;
function loadUI() {
  try { Object.assign(UI, JSON.parse(localStorage.getItem(LS_UI) || '{}')); } catch (e) { /* ignore */ }
  UI.favs = UI.favs || {};
}

function save() {
  if (CLOUD) { Cloud.schedule(); return; }
  clearTimeout(saveTimer);
  $('#saved').textContent = 'Enregistrement…';
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(S));
      $('#saved').textContent = 'Enregistré';
    } catch (e) {
      $('#saved').textContent = 'Non enregistré !';
      toast('Impossible d’enregistrer (stockage plein ou bloqué). Exporte une sauvegarde.');
    }
  }, 300);
}
function saveUI() { try { localStorage.setItem(LS_UI, JSON.stringify(UI)); } catch (e) { /* ignore */ } }
function touch(page) { page.updatedAt = Date.now(); save(); History.track(page); History.buttons(); }

/* ---------- Arbre des pages ---------- */

function childrenOf(pid) {
  return Object.values(S.pages).filter((p) => p.parentId === pid && !p.trashed).sort((a, b) => a.pos - b.pos);
}
function isDeleted(p) {
  for (let x = p; x; x = S.pages[x.parentId]) if (x.trashed) return true;
  return false;
}
function ancestors(p) {
  const out = [];
  for (let x = S.pages[p.parentId]; x; x = S.pages[x.parentId]) out.unshift(x);
  return out;
}
function descendants(id) {
  const out = [];
  const walk = (pid) => Object.values(S.pages).forEach((p) => { if (p.parentId === pid) { out.push(p); walk(p.id); } });
  walk(id);
  return out;
}
const isFav = (p) => !!UI.favs[p.id];
function toggleFav(p) { if (UI.favs[p.id]) delete UI.favs[p.id]; else UI.favs[p.id] = true; saveUI(); }
const titleOf = (p) => (p && p.title.trim()) || 'Sans titre';
const isFolder = (p) => !!p && p.kind === 'folder';
const iconOf = (p) => (p && p.icon) || (isFolder(p) ? (UI.expanded[p.id] ? '📂' : '📁') : '📄');
function newFolder(parentId = null) {
  const f = newPage(parentId, '', 'folder');
  save();
  return f;
}

/* ---------- Nettoyage HTML (formatage inline seulement) ---------- */

const ALLOWED = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', CODE: 'code', A: 'a', BR: 'br' };
function sanitize(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';
  const walk = (node) => {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) out += esc(n.textContent);
      else if (n.nodeType === 1) {
        const tag = ALLOWED[n.tagName];
        const inner = walk(n);
        if (!tag) out += (n.tagName === 'DIV' || n.tagName === 'P') && out ? '<br>' + inner : inner;
        else if (tag === 'br') out += '<br>';
        else if (tag === 'a') {
          const href = n.getAttribute('href') || '';
          out += /^(https?:|mailto:)/i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>` : inner;
        } else out += `<${tag}>${inner}</${tag}>`;
      }
    });
    return out;
  };
  return walk(tpl.content);
}
const plain = (html) => { const t = document.createElement('template'); t.innerHTML = html || ''; return t.content.textContent; };

/* ---------- Curseur ---------- */

function caretOffset(el) {
  const sel = getSelection();
  if (!sel.rangeCount || !el.contains(sel.anchorNode)) return -1;
  const r = sel.getRangeAt(0).cloneRange();
  r.selectNodeContents(el);
  r.setEnd(sel.focusNode, sel.focusOffset);
  return r.toString().length;
}
function pointAt(el, offset) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n, left = offset;
  while ((n = w.nextNode())) {
    if (left <= n.length) return [n, left];
    left -= n.length;
  }
  return [el, el.childNodes.length];
}
function setCaret(el, offset) {
  el.focus();
  const sel = getSelection();
  const r = document.createRange();
  if (offset === 'end' || offset == null) { r.selectNodeContents(el); r.collapse(false); }
  else { const [n, o] = pointAt(el, Math.max(0, offset)); r.setStart(n, o); r.collapse(true); }
  sel.removeAllRanges();
  sel.addRange(r);
}
function rangeOf(el, start, end) {
  const r = document.createRange();
  const [a, ao] = pointAt(el, start);
  const [b, bo] = pointAt(el, end);
  r.setStart(a, ao);
  r.setEnd(b, bo);
  return r;
}
function caretRect() {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0).cloneRange();
  r.collapse(true);
  const rects = r.getClientRects();
  if (rects.length) return rects[0];
  const rect = r.getBoundingClientRect();
  return rect.height ? rect : null;
}
function onFirstLine(el) {
  const c = caretRect();
  if (!c) return true;
  return c.top - el.getBoundingClientRect().top < parseFloat(getComputedStyle(el).lineHeight) * 0.9 + 4;
}
function onLastLine(el) {
  const c = caretRect();
  if (!c) return true;
  return el.getBoundingClientRect().bottom - c.bottom < parseFloat(getComputedStyle(el).lineHeight) * 0.9 + 4;
}
function htmlAfterCaret(el) {
  const sel = getSelection();
  const r = sel.getRangeAt(0).cloneRange();
  r.deleteContents();
  r.setEndAfter(el.lastChild || el);
  if (!el.lastChild) return '';
  const frag = r.extractContents();
  const d = document.createElement('div');
  d.append(frag);
  return d.innerHTML;
}

/* ---------- Rendu : barre latérale ---------- */

function renderSidebar() {
  const tree = $('#tree');
  tree.innerHTML = '';
  const roots = childrenOf(null);
  if (!roots.length) tree.append(h('div', { class: 'tree-empty', style: { paddingLeft: '14px' } }, 'Aucune page'));
  const addRows = (list, depth, container) => {
    list.forEach((p) => {
      const kids = childrenOf(p.id);
      const open = !!UI.expanded[p.id];
      container.append(treeRow(p, depth, kids.length > 0, open));
      if (open) {
        if (kids.length) addRows(kids, depth + 1, container);
        else container.append(h('div', { class: 'tree-empty', style: { paddingLeft: 30 + (depth + 1) * 14 + 'px' } }, isFolder(p) ? 'Dossier vide' : 'Aucune page à l’intérieur'));
      }
    });
  };
  addRows(roots, 0, tree);

  const favs = Object.values(S.pages).filter((p) => isFav(p) && !isDeleted(p));
  $('#sec-fav').hidden = !favs.length;
  const ft = $('#tree-fav');
  ft.innerHTML = '';
  favs.forEach((p) => ft.append(treeRow(p, 0, false, false, true)));
}

function treeRow(p, depth, hasKids, open, flat) {
  const row = h('div', { class: 'tree-row' + (p.id === current ? ' active' : '') + (isFolder(p) ? ' folder' : ''), style: { paddingLeft: 4 + depth * 14 + 'px' }, title: titleOf(p), 'data-id': p.id, draggable: flat ? null : 'true' },
    flat ? h('span', { class: 'ico', style: { width: '20px' } }) : h('button', {
      class: 'arrow' + (open ? ' open' : ''), title: 'Déplier',
      onclick: (e) => { e.stopPropagation(); UI.expanded[p.id] = !open; saveUI(); renderSidebar(); },
    }, '▶'),
    h('span', { class: 'ico' }, iconOf(p)),
    h('span', { class: 'name' }, titleOf(p)),
    h('span', { class: 'acts' },
      h('button', { class: 'icon-btn small', title: 'Plus', onclick: (e) => { e.stopPropagation(); pageMenu(p, e.currentTarget); } }, '⋯'),
      h('button', { class: 'icon-btn small', title: isFolder(p) ? 'Ajouter une page dans ce dossier' : 'Ajouter une sous-page', onclick: (e) => { e.stopPropagation(); go(newPage(p.id).id, true); } }, '＋')),
  );
  row.addEventListener('click', () => {
    if (isFolder(p) && !flat && (p.id === current || !UI.expanded[p.id])) { UI.expanded[p.id] = p.id === current ? !UI.expanded[p.id] : true; saveUI(); }
    go(p.id);
    if (innerWidth <= 760 && !isFolder(p)) setSidebar(false);
  });
  return row;
}

/* ---------- Rendu : page ---------- */

function go(id, focusTitle) {
  if (location.hash !== '#/' + id) history.pushState(null, '', '#/' + id);
  current = id;
  render(focusTitle);
}

let renderedPage = null;
function render(focusTitle) {
  if (renderedPage && renderedPage !== current) { History.commit(renderedPage); Versions.leave(renderedPage); Select.clear(); }
  const p = S.pages[current];
  closePop();
  if (!p || isDeleted(p)) {
    const first = childrenOf(null)[0];
    if (first) { current = first.id; history.replaceState(null, '', '#/' + first.id); return render(); }
    current = null;
  }
  renderedPage = current;
  if (S.pages[current]) History.ensure(S.pages[current]);
  History.buttons();
  renderSidebar();
  renderTop();
  renderPage();
  if (CLOUD) Cloud.here(null);
  if (focusTitle) setCaret($('.page-title'), 'end');
}

function renderTop() {
  const p = S.pages[current];
  const cr = $('#crumbs');
  cr.innerHTML = '';
  if (!p) return;
  [...ancestors(p), p].forEach((x, i) => {
    if (i) cr.append(h('span', { class: 'sep' }, '/'));
    cr.append(h('a', { href: '#/' + x.id }, `${iconOf(x)} ${titleOf(x)}`));
  });
  const fav = $('#btn-fav');
  fav.textContent = isFav(p) ? '★' : '☆';
  fav.classList.toggle('on', isFav(p));
  document.title = `${titleOf(p)} · ReNotion`;
}

function renderPage() {
  const root = $('#page');
  root.innerHTML = '';
  const p = S.pages[current];
  if (!p) {
    root.append(h('div', { class: 'wrap page-head' },
      h('div', { class: 'page-title', contenteditable: false }, 'Aucune page'),
      h('p', { class: 'muted' }, 'Crée une page pour commencer.'),
      h('button', { class: 'btn primary', onclick: () => go(newPage(null).id, true) }, 'Nouvelle page')));
    return;
  }
  root.classList.toggle('has-cover', !!p.cover);
  if (p.cover) {
    root.append(h('div', { class: 'cover', style: { background: p.cover } },
      h('div', { class: 'cover-btns' },
        h('button', { class: 'chip', onclick: (e) => coverPicker(p, e.currentTarget) }, 'Changer la couverture'),
        h('button', { class: 'chip', onclick: () => { p.cover = ''; touch(p); renderPage(); } }, 'Retirer'))));
  }
  const title = h('div', { class: 'page-title', contenteditable: 'plaintext-only', spellcheck: 'true' });
  title.textContent = p.title;
  title.addEventListener('input', () => {
    p.title = title.textContent.replace(/\n/g, ' ');
    touch(p);
    renderSidebar();
    renderTop();
    document.querySelectorAll(`.page-link[data-page="${p.id}"] .t`).forEach((t) => { t.textContent = titleOf(p); });
  });
  title.addEventListener('keydown', (e) => {
    if (isFolder(p) && e.key === 'Enter') { e.preventDefault(); title.blur(); return; }
    if (!isFolder(p) && (e.key === 'Enter' || (e.key === 'ArrowDown' && onLastLine(title)))) {
      e.preventDefault();
      if (e.key === 'Enter' && caretOffset(title) === 0 && p.title) {
        p.blocks.unshift({ id: uid(), type: 'p', text: '', indent: 0 });
        touch(p);
        renderBlocks();
      }
      if (!p.blocks.length) { p.blocks.push({ id: uid(), type: 'p', text: '', indent: 0 }); renderBlocks(); }
      focusBlock(p.blocks[0].id, 0);
    }
  });
  title.addEventListener('paste', (e) => {
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s*\n\s*/g, ' '));
  });

  const head = h('div', { class: 'wrap page-head' },
    p.icon ? h('div', { class: 'page-icon', title: 'Changer l’icône', onclick: (e) => emojiPicker(e.currentTarget, (em) => { p.icon = em; touch(p); render(); }, true) }, p.icon) : null,
    h('div', { class: 'head-btns' },
      p.icon ? null : h('button', { onclick: () => { p.icon = EMOJIS[Math.floor(Math.random() * EMOJIS.length)]; touch(p); render(); } }, '☺ Ajouter une icône'),
      p.cover ? null : h('button', { onclick: () => { p.cover = COVERS[Math.floor(Math.random() * COVERS.length)]; touch(p); renderPage(); } }, '🖼 Ajouter une couverture')),
    title);
  root.append(head);

  if (isFolder(p)) { root.append(folderView(p)); return; }
  const wrap = h('div', { class: 'wrap' }, h('div', { class: 'blocks', id: 'blocks' }),
    Extras.hints(p),
    h('div', { class: 'add-below', onclick: addBelowClick }));
  root.append(wrap);
  Media.bindDrop(wrap);
  bindBlocks($('#blocks'));
  renderBlocks();
}

function relTime(t) {
  const d = (Date.now() - (t || 0)) / 1000;
  if (d < 60) return 'à l’instant';
  if (d < 3600) return `il y a ${Math.floor(d / 60)} min`;
  if (d < 86400) return `il y a ${Math.floor(d / 3600)} h`;
  if (d < 86400 * 30) return `il y a ${Math.floor(d / 86400)} j`;
  return new Date(t).toLocaleDateString('fr-FR');
}

function folderView(f) {
  const kids = childrenOf(f.id);
  const count = (x) => childrenOf(x.id).length;
  const snippet = (x) => {
    const b = x.blocks.find((y) => y.type !== 'page' && y.type !== 'divider' && (y.type === 'table' ? (y.rows || []).some((r) => r.some(Boolean)) : plain(y.text).trim()));
    return b ? (b.type === 'table' ? Table.plainText(b) : b.type === 'code' ? b.text : plain(b.text)).slice(0, 140) : '';
  };
  const grid = h('div', { class: 'cards' }, kids.map((k) => h('a', { class: 'card' + (isFolder(k) ? ' is-folder' : ''), href: '#/' + k.id, 'data-id': k.id, draggable: 'true' },
    h('div', { class: 'card-ico' }, iconOf(k)),
    h('div', { class: 'card-title' }, titleOf(k)),
    h('div', { class: 'card-snip' }, isFolder(k) ? `${count(k)} élément${count(k) > 1 ? 's' : ''}` : snippet(k) || 'Page vide'),
    h('div', { class: 'card-meta' }, isFolder(k) ? 'Dossier' : 'Modifiée ' + relTime(k.updatedAt)))));
  bindTreeDnd(grid, '.card');
  return h('div', { class: 'wrap folder-view' },
    h('div', { class: 'folder-actions' },
      h('button', { class: 'btn primary', onclick: () => go(newPage(f.id).id, true) }, '＋ Nouvelle page'),
      h('button', { class: 'btn', onclick: () => { const nf = newFolder(f.id); go(nf.id, true); } }, '📁 Nouveau dossier'),
      h('span', { class: 'muted' }, kids.length ? `${kids.length} élément${kids.length > 1 ? 's' : ''} · glisse des pages ici depuis la barre latérale` : '')),
    kids.length ? grid : h('div', { class: 'folder-empty' }, h('div', { style: { fontSize: '40px' } }, '📂'), 'Ce dossier est vide.', h('br'), 'Crée une page ou glisse-en une ici depuis la barre latérale.'));
}

/* ---------- Glisser-déposer dans l'arbre (et dans les dossiers) ---------- */

let dragPage = null;

function canDrop(id, targetId) {
  if (!id || id === targetId) return false;
  for (let x = S.pages[targetId]; x; x = S.pages[x.parentId]) if (x.id === id) return false;
  return true;
}

function movePage(id, targetId, zone) {
  const p = S.pages[id];
  const t = targetId && S.pages[targetId];
  if (!p) return;
  if (!t || zone === 'inside') {
    const parent = t ? t.id : null;
    const sib = childrenOf(parent).filter((x) => x.id !== id);
    p.parentId = parent;
    p.pos = sib.length ? sib[sib.length - 1].pos + 1 : 0;
    if (parent) UI.expanded[parent] = true;
  } else {
    const sib = childrenOf(t.parentId).filter((x) => x.id !== id);
    const i = sib.findIndex((x) => x.id === t.id);
    const other = zone === 'before' ? sib[i - 1] : sib[i + 1];
    p.parentId = t.parentId || null;
    p.pos = other ? (t.pos + other.pos) / 2 : t.pos + (zone === 'before' ? -1 : 1);
  }
  saveUI();
  touch(p);
  renderSidebar();
  renderTop();
  const cur = S.pages[current];
  if (isFolder(cur)) renderPage();
}

function bindTreeDnd(box, sel) {
  const clear = () => document.querySelectorAll('.drop-before, .drop-after, .drop-inside').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-inside'));
  box.addEventListener('dragstart', (e) => {
    const row = e.target.closest(sel);
    if (!row) return;
    dragPage = row.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', titleOf(S.pages[dragPage]));
  });
  box.addEventListener('dragover', (e) => {
    if (!dragPage) return;
    const row = e.target.closest(sel);
    clear();
    if (!row) { if (sel === '.tree-row') { e.preventDefault(); box.classList.add('drop-inside'); } return; }
    if (!canDrop(dragPage, row.dataset.id)) return;
    e.preventDefault();
    const r = row.getBoundingClientRect();
    const y = sel === '.card' ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    const t = S.pages[row.dataset.id];
    // sur un dossier, le centre veut dire « dedans » ; sur une page, seulement le milieu étroit
    const inner = isFolder(t) ? [0.25, 0.75] : [0.35, 0.65];
    row.classList.add(y < inner[0] ? 'drop-before' : y > inner[1] ? 'drop-after' : 'drop-inside');
  });
  box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) clear(); });
  box.addEventListener('drop', (e) => {
    if (!dragPage) return;
    e.preventDefault();
    const row = box.querySelector('.drop-before, .drop-after, .drop-inside');
    const zone = row ? (row.classList.contains('drop-before') ? 'before' : row.classList.contains('drop-after') ? 'after' : 'inside') : null;
    const id = dragPage;
    dragPage = null;
    clear();
    if (row && row !== box) movePage(id, row.dataset.id, zone);
    else if (sel === '.tree-row') movePage(id, null, 'inside');
  });
  box.addEventListener('dragend', () => { dragPage = null; clear(); });
}

function addBelowClick() {
  const p = S.pages[current];
  const last = p.blocks[p.blocks.length - 1];
  if (!last || last.type !== 'p' || plain(last.text).trim()) {
    p.blocks.push({ id: uid(), type: 'p', text: '', indent: 0 });
    touch(p);
    renderBlocks();
  }
  focusBlock(p.blocks[p.blocks.length - 1].id, 'end');
}

/* ---------- Rendu : blocs ---------- */

function visibleBlocks(p) {
  const out = [];
  let hideAbove = Infinity;
  for (const b of p.blocks) {
    const ind = b.indent || 0;
    if (ind > hideAbove) continue;
    hideAbove = Infinity;
    out.push(b);
    if (b.type === 'toggle' && b.collapsed) hideAbove = ind;
  }
  return out;
}

function renderBlocks() {
  const p = S.pages[current];
  const box = $('#blocks');
  if (!p || !box) return;
  box.innerHTML = '';
  const counters = [];
  const lastType = [];
  const vis = visibleBlocks(p);
  vis.forEach((b) => {
    const ind = b.indent || 0;
    counters.length = ind + 1;
    lastType.length = ind + 1;
    let num = 0;
    if (b.type === 'ol') num = counters[ind] = lastType[ind] === 'ol' ? counters[ind] + 1 : 1;
    lastType[ind] = b.type;
    box.append(blockEl(b, num, p.blocks.length === 1));
  });
  Media.hydrate(box);
  Select.paint();
  if (CLOUD) Cloud.decorate();
}

function blockEl(b, num, only) {
  const row = h('div', { class: 'block' + (b.checked && b.type === 'todo' ? ' done' : '') + (only ? ' only' : ''), 'data-id': b.id, 'data-type': b.type, style: { '--indent': b.indent || 0 } });
  row.append(h('div', { class: 'handle' },
    h('button', { class: 'add', title: 'Ajouter un bloc en dessous', 'data-act': 'add' }, '＋'),
    h('button', { class: 'drag', title: 'Glisser pour déplacer · Cliquer pour le menu', draggable: 'true', 'data-act': 'menu' }, '⋮⋮')));

  const prefix = h('div', { class: 'prefix' });
  if (b.type === 'ul') prefix.append(h('span', { class: 'bullet' }, ['•', '◦', '▪'][(b.indent || 0) % 3]));
  else if (b.type === 'ol') prefix.append(h('span', { class: 'num' }, num + '.'));
  else if (b.type === 'todo') prefix.append(h('span', { class: 'check' + (b.checked ? ' on' : ''), 'data-act': 'check', role: 'checkbox', 'aria-checked': String(!!b.checked) }, b.checked ? '✓' : ''));
  else if (b.type === 'toggle') prefix.append(h('button', { class: 'tog' + (b.collapsed ? '' : ' open'), 'data-act': 'toggle', title: b.collapsed ? 'Déplier' : 'Replier' }, '▶'));
  else if (b.type === 'callout') prefix.append(h('span', { class: 'callout-ico', 'data-act': 'callout' }, b.icon || '💡'));
  else prefix.style.minWidth = '0';
  row.append(prefix);

  if (b.type === 'divider') {
    row.tabIndex = 0;
    row.append(h('div', { class: 'content' }, h('hr')));
  } else if (b.type === 'table') {
    row.tabIndex = -1;
    row.append(Table.render(b));
  } else if (Media.isMedia(b)) {
    row.tabIndex = 0;
    row.append(Media.render(b));
  } else if (b.type === 'toc') {
    row.tabIndex = 0;
    row.append(Extras.renderToc(pg()));
  } else if (b.type === 'page') {
    row.tabIndex = 0;
    const sp = S.pages[b.pageId];
    row.append(h('div', { class: 'content' }, sp && !isDeleted(sp)
      ? h('span', { class: 'page-link', 'data-page': sp.id, 'data-act': 'open' }, h('span', {}, iconOf(sp)), h('span', { class: 't' }, titleOf(sp)))
      : h('span', { class: 'muted' }, 'Page supprimée')));
  } else {
    const c = h('div', { class: 'content', contenteditable: b.type === 'code' ? 'plaintext-only' : 'true', spellcheck: b.type === 'code' ? 'false' : 'true', 'data-ph': PLACEHOLDER[b.type] || '' });
    if (b.type === 'code') {
      c.textContent = b.text;
      row.append(h('span', { class: 'code-lang' }, b.lang || 'Code'),
        h('div', { class: 'code-tools' }, h('button', { class: 'chip', 'data-act': 'copy' }, 'Copier')));
    } else c.innerHTML = sanitize(b.text);
    row.append(c);
  }
  return row;
}

function focusBlock(id, pos = 'end') {
  const row = $(`.block[data-id="${id}"]`);
  if (!row) return;
  if (row.dataset.type === 'table') { Table.focus(blk(id), pos === 'end' ? 'end' : 0); return; }
  const c = row.querySelector('.content[contenteditable]');
  if (c) setCaret(c, pos);
  else row.focus();
}

/* ---------- Opérations sur les blocs ---------- */

const pg = () => S.pages[current];
const idx = (id) => pg().blocks.findIndex((b) => b.id === id);
const blk = (id) => pg().blocks.find((b) => b.id === id);
function subtreeEnd(i) {
  const bl = pg().blocks;
  const ind = bl[i].indent || 0;
  let j = i + 1;
  while (j < bl.length && (bl[j].indent || 0) > ind) j++;
  return j;
}
function readContent(b, el) {
  b.text = b.type === 'code' ? el.textContent : el.innerHTML.replace(/^<br>$/, '');
}
function insertAfter(id, nb) {
  const p = pg();
  p.blocks.splice(idx(id) + 1, 0, nb);
  touch(p);
  return nb;
}
function prevVisible(id) {
  const vis = visibleBlocks(pg());
  const i = vis.findIndex((b) => b.id === id);
  return vis[i - 1];
}
function nextVisible(id) {
  const vis = visibleBlocks(pg());
  const i = vis.findIndex((b) => b.id === id);
  return vis[i + 1];
}
function setType(b, type) {
  if (b.type === 'code' && type !== 'code') b.text = esc(b.text).replace(/\n/g, '<br>');
  else if (type === 'code' && b.type !== 'code') b.text = plain(b.text.replace(/<br>/g, '\n'));
  if (type === 'table' && b.type !== 'table') Table.create(b, b.type === 'code' ? esc(b.text) : b.text);
  b.type = type;
  if (type === 'callout' && !b.icon) b.icon = '💡';
  if (type === 'toggle') b.collapsed = false;
  if (type === 'divider') b.text = '';
}
function turnInto(b, type) {
  const p = pg();
  if (type === 'page') {
    const sp = newPage(p.id, plain(b.text).trim());
    b.type = 'page';
    b.text = '';
    b.pageId = sp.id;
    touch(p);
    go(sp.id, true);
    return;
  }
  setType(b, type);
  touch(p);
  renderBlocks();
  if (type === 'divider') {
    const nb = { id: uid(), type: 'p', text: '', indent: b.indent || 0 };
    const nxt = p.blocks[idx(b.id) + 1];
    if (!nxt) insertAfter(b.id, nb), renderBlocks(), focusBlock(nb.id, 0);
    else focusBlock(nxt.id, 0);
  } else focusBlock(b.id, type === 'table' ? 0 : 'end');
  renderSidebar();
}
function deleteBlock(id) {
  const p = pg();
  const i = idx(id);
  if (i < 0) return;
  const prev = prevVisible(id) || nextVisible(id);
  p.blocks.splice(i, 1);
  if (!p.blocks.length) p.blocks.push({ id: uid(), type: 'p', text: '', indent: 0 });
  touch(p);
  renderBlocks();
  focusBlock(prev ? prev.id : p.blocks[0].id, 'end');
}
function duplicateBlock(id) {
  const p = pg();
  const i = idx(id);
  const j = subtreeEnd(i);
  const copies = p.blocks.slice(i, j).map((b) => ({ ...JSON.parse(JSON.stringify(b)), id: uid() }));
  p.blocks.splice(j, 0, ...copies);
  touch(p);
  renderBlocks();
  focusBlock(copies[0].id, 'end');
}
function moveBlock(id, targetId, after) {
  const p = pg();
  const i = idx(id);
  const j = subtreeEnd(i);
  const group = p.blocks.slice(i, j);
  if (group.some((b) => b.id === targetId)) return;
  p.blocks.splice(i, j - i);
  const ti = idx(targetId);
  const t = after ? subtreeEnd(ti) : ti;
  const delta = (p.blocks[ti].indent || 0) - (group[0].indent || 0);
  group.forEach((b) => { b.indent = Math.max(0, (b.indent || 0) + delta); });
  p.blocks.splice(t, 0, ...group);
  touch(p);
  renderBlocks();
}
function shiftBlock(id, dir) {
  const p = pg();
  const vis = visibleBlocks(p);
  const k = vis.findIndex((b) => b.id === id);
  const other = vis[k + dir];
  if (!other) return;
  moveBlock(id, other.id, dir > 0);
}

/* ---------- Éditeur : événements ---------- */

let slash = null; // { id, start }
let lastCell = null; // dernière cellule de tableau active
let dragId = null;

function bindBlocks(box) {
  box.addEventListener('input', onInput);
  box.addEventListener('keydown', onKey);
  box.addEventListener('paste', onPaste);
  box.addEventListener('click', onClick);
  box.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const tb = blk(cell.closest('.block').dataset.id);
    if (!tb) return;
    e.preventDefault();
    menu({ getBoundingClientRect: () => ({ left: e.clientX, top: e.clientY, bottom: e.clientY }) }, Table.cellMenu(tb, +cell.dataset.r, +cell.dataset.c));
  });
  box.addEventListener('focusin', (e) => {
    const cell = e.target.closest('.cell');
    if (cell) lastCell = { id: cell.closest('.block').dataset.id, r: +cell.dataset.r, c: +cell.dataset.c };
  });
  let focusedBlock = null;
  box.addEventListener('focusin', (e) => {
    const row = e.target.closest('.block');
    // changer de bloc clôt le groupe de frappe en cours pour Ctrl+Z
    if (row && row.dataset.id !== focusedBlock) { if (focusedBlock) History.commit(current); focusedBlock = row.dataset.id; }
  });
  box.addEventListener('focusin', (e) => { const row = e.target.closest('.block'); if (CLOUD && row) Cloud.here(row.dataset.id); });
  box.addEventListener('mousedown', (e) => { if (e.target.closest('[data-act]') && e.target.closest('.prefix')) e.preventDefault(); });
  box.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.block');
    if (!row || !e.target.closest('.drag')) return;
    dragId = row.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    e.dataTransfer.setDragImage(row, 0, 0);
  });
  box.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    clearDrop();
    const row = e.target.closest('.block');
    if (!row || row.dataset.id === dragId) return;
    const r = row.getBoundingClientRect();
    row.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });
  box.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const row = box.querySelector('.drop-before, .drop-after');
    if (row) moveBlock(dragId, row.dataset.id, row.classList.contains('drop-after'));
    clearDrop();
    dragId = null;
  });
  box.addEventListener('dragend', () => { clearDrop(); dragId = null; });
}
function clearDrop() { document.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); }

const SHORTCUTS = [
  [/^#\s$/, 'h1'], [/^##\s$/, 'h2'], [/^###\s$/, 'h3'], [/^[-*+]\s$/, 'ul'], [/^1[.)]\s$/, 'ol'],
  [/^\[\s?\]\s$/, 'todo'], [/^>\s$/, 'toggle'], [/^["“]\s$/, 'quote'], [/^```$/, 'code'], [/^---$/, 'divider'],
];

function onInput(e) {
  const cell = e.target.closest('.cell');
  if (cell) { const tb = blk(cell.closest('.block').dataset.id); if (tb) Table.onInput(tb, cell); return; }
  const c = e.target.closest('.content');
  if (!c) return;
  const row = c.closest('.block');
  const b = blk(row.dataset.id);
  if (!b) return;
  readContent(b, c);
  row.classList.toggle('only', false);
  touch(pg());
  if (/^h[123]$/.test(b.type)) Extras.refreshToc();
  const hints = c.textContent && !c.textContent.startsWith('/') && $('.tpl-hints');
  if (hints) hints.remove();

  if (b.type !== 'code') {
    const txt = c.textContent;
    const off = caretOffset(c);
    for (const [re, type] of SHORTCUTS) {
      const m = txt.slice(0, off).match(re);
      if (m && (b.type === 'p' || (type !== b.type && LIST_TYPES.includes(b.type) && LIST_TYPES.includes(type)))) {
        rangeOf(c, 0, m[0].length).deleteContents();
        readContent(b, c);
        if (/^\[/.test(m[0])) b.checked = false;
        turnInto(b, type);
        if (type !== 'divider') focusBlock(b.id, 0);
        return;
      }
    }
  }

  if (e.data === '/' && b.type !== 'code') {
    slash = { id: b.id, start: caretOffset(c) - 1 };
    openSlash();
  } else if (slash) updateSlash();
}

function onKey(e) {
  const c = e.target.closest('.content[contenteditable]');
  const row = e.target.closest('.block');
  if (!row) return;
  const b = blk(row.dataset.id);
  if (!b) return;

  const cell = e.target.closest('.cell');
  if (cell) { Table.onKey(e, b, cell); return; }

  if (slash && slashKey(e)) return;

  // Blocs non éditables (séparateur, lien de page)
  if (!c) {
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteBlock(b.id); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (b.type === 'page') return go(b.pageId);
      const nb = insertAfter(b.id, { id: uid(), type: 'p', text: '', indent: b.indent || 0 });
      renderBlocks();
      focusBlock(nb.id, 0);
    } else if (e.key === 'ArrowUp') { e.preventDefault(); const pv = prevVisible(b.id); if (pv) focusBlock(pv.id, 'end'); else setCaret($('.page-title'), 'end'); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); const nx = nextVisible(b.id); if (nx) focusBlock(nx.id, 0); }
    return;
  }

  const mod = e.ctrlKey || e.metaKey;
  const sel = getSelection();
  const collapsed = sel.isCollapsed;
  const off = caretOffset(c);

  if (mod && e.key.toLowerCase() === 'e' && b.type !== 'code') { e.preventDefault(); wrapInline('code', c, b); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'x' && b.type !== 'code') { e.preventDefault(); document.execCommand('strikeThrough'); readContent(b, c); touch(pg()); return; }
  if (mod && e.key.toLowerCase() === 'k' && !collapsed && b.type !== 'code') {
    e.preventDefault();
    e.stopPropagation();
    const r = sel.getRangeAt(0).cloneRange();
    const url = prompt('Adresse du lien (https://…)');
    if (url && /^(https?:|mailto:)/i.test(url.trim())) {
      sel.removeAllRanges(); sel.addRange(r);
      document.execCommand('createLink', false, url.trim());
      readContent(b, c); touch(pg());
    }
    return;
  }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateBlock(b.id); return; }
  if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    shiftBlock(b.id, e.key === 'ArrowUp' ? -1 : 1);
    focusBlock(b.id, off);
    return;
  }

  if (e.key === 'Enter' && b.type === 'code') {
    if (mod || e.shiftKey) {
      e.preventDefault();
      const nx = insertAfter(b.id, { id: uid(), type: 'p', text: '', indent: b.indent || 0 });
      renderBlocks(); focusBlock(nx.id, 0);
    }
    return; // Entrée = saut de ligne dans le code
  }

  if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); return; }

  if (e.key === 'Enter') {
    e.preventDefault();
    const empty = !c.textContent.length;
    if (empty && LIST_TYPES.concat(['quote', 'callout']).includes(b.type)) {
      if ((b.indent || 0) > 0) b.indent--; else setType(b, 'p');
      touch(pg()); renderBlocks(); focusBlock(b.id, 0);
      return;
    }
    if (off === 0 && !empty) {
      const nb = { id: uid(), type: CONTINUE_TYPES.includes(b.type) ? b.type : 'p', text: '', indent: b.indent || 0 };
      pg().blocks.splice(idx(b.id), 0, nb);
      touch(pg()); renderBlocks(); focusBlock(b.id, 0);
      return;
    }
    const rest = htmlAfterCaret(c);
    readContent(b, c);
    let nb;
    if (b.type === 'toggle') {
      b.collapsed = false;
      nb = { id: uid(), type: 'p', text: rest, indent: (b.indent || 0) + 1 };
    } else {
      nb = { id: uid(), type: CONTINUE_TYPES.includes(b.type) ? b.type : 'p', text: rest, indent: b.indent || 0 };
    }
    if (b.type === 'todo') nb.checked = false;
    insertAfter(b.id, nb);
    renderBlocks();
    focusBlock(nb.id, 0);
    return;
  }

  if (e.key === 'Backspace' && collapsed && off === 0) {
    if (b.type !== 'p' && b.type !== 'code') {
      e.preventDefault(); setType(b, 'p'); touch(pg()); renderBlocks(); focusBlock(b.id, 0); return;
    }
    if (b.type === 'code' && c.textContent.length) return;
    if ((b.indent || 0) > 0) { e.preventDefault(); b.indent--; touch(pg()); renderBlocks(); focusBlock(b.id, 0); return; }
    const pv = prevVisible(b.id);
    e.preventDefault();
    if (!pv) {
      if (!c.textContent.length && pg().blocks.length > 1) deleteBlock(b.id);
      else setCaret($('.page-title'), 'end');
      return;
    }
    if (pv.type === 'table') {
      if (!c.textContent.length) { pg().blocks.splice(idx(b.id), 1); touch(pg()); renderBlocks(); }
      focusBlock(pv.id, 'end');
      return;
    }
    if (pv.type === 'divider' || pv.type === 'page') {
      if (!c.textContent.length) { deleteBlock(b.id); return; }
      pg().blocks.splice(idx(pv.id), 1); touch(pg()); renderBlocks(); focusBlock(b.id, 0); return;
    }
    const pvLen = pv.type === 'code' ? pv.text.length : plain(pv.text).length;
    readContent(b, c);
    if (pv.type === 'code') pv.text += plain(b.text.replace(/<br>/g, '\n'));
    else pv.text = (pv.text || '').replace(/<br>$/, '') + (b.type === 'code' ? esc(b.text) : b.text);
    pg().blocks.splice(idx(b.id), 1);
    touch(pg()); renderBlocks(); focusBlock(pv.id, pvLen);
    return;
  }

  if (e.key === 'Delete' && collapsed && off === c.textContent.length) {
    const nx = nextVisible(b.id);
    if (!nx || nx.type === 'table') return;
    e.preventDefault();
    if (nx.type === 'divider' || nx.type === 'page') { pg().blocks.splice(idx(nx.id), 1); }
    else if (b.type !== 'code' && nx.type !== 'code') { b.text = (b.text || '').replace(/<br>$/, '') + nx.text; pg().blocks.splice(idx(nx.id), 1); }
    else return;
    touch(pg()); renderBlocks(); focusBlock(b.id, off);
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    if (b.type === 'code' && !e.shiftKey) { document.execCommand('insertText', false, '  '); return; }
    const p = pg();
    const i = idx(b.id);
    const end = subtreeEnd(i);
    if (e.shiftKey) {
      if (!(b.indent || 0)) return;
      for (let k = i; k < end; k++) p.blocks[k].indent = Math.max(0, (p.blocks[k].indent || 0) - 1);
    } else {
      const pv = prevVisible(b.id);
      if (!pv || (b.indent || 0) > (pv.indent || 0) || (b.indent || 0) >= 8) return;
      for (let k = i; k < end; k++) p.blocks[k].indent = (p.blocks[k].indent || 0) + 1;
    }
    readContent(b, c);
    touch(p); renderBlocks(); focusBlock(b.id, off);
    return;
  }

  if (e.key === 'ArrowUp' && !e.shiftKey && onFirstLine(c)) {
    const pv = prevVisible(b.id);
    e.preventDefault();
    if (pv) focusBlock(pv.id, 'end'); else setCaret($('.page-title'), 'end');
    return;
  }
  if (e.key === 'ArrowDown' && !e.shiftKey && onLastLine(c)) {
    const nx = nextVisible(b.id);
    if (nx) { e.preventDefault(); focusBlock(nx.id, 0); }
    return;
  }
  if (e.key === 'ArrowLeft' && collapsed && off === 0) {
    const pv = prevVisible(b.id);
    if (pv) { e.preventDefault(); focusBlock(pv.id, 'end'); }
    return;
  }
  if (e.key === 'ArrowRight' && collapsed && off === c.textContent.length) {
    const nx = nextVisible(b.id);
    if (nx) { e.preventDefault(); focusBlock(nx.id, 0); }
  }
}

function wrapInline(tag, c, b) {
  const sel = getSelection();
  if (sel.isCollapsed) return;
  const r = sel.getRangeAt(0);
  const anc = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
  const existing = anc.closest(tag);
  if (existing && c.contains(existing)) {
    existing.replaceWith(...existing.childNodes);
  } else {
    const el = document.createElement(tag);
    el.append(r.extractContents());
    r.insertNode(el);
    sel.removeAllRanges();
    const nr = document.createRange();
    nr.selectNodeContents(el);
    sel.addRange(nr);
  }
  readContent(b, c);
  touch(pg());
}

function parseLine(line) {
  const rules = [
    [/^#{3,6}\s+/, 'h3'], [/^##\s+/, 'h2'], [/^#\s+/, 'h1'], [/^\s*[-*+]\s+\[( |x|X)\]\s+/, 'todo'], [/^\s*\[( |x|X)?\]\s+/, 'todo'],
    [/^\s*[-*+•]\s+/, 'ul'], [/^\s*\d+[.)]\s+/, 'ol'], [/^>\s+/, 'quote'], [/^(-{3,}|\*{3,})\s*$/, 'divider'],
  ];
  const indent = Math.min(8, Math.floor((line.match(/^\s*/)[0].replace(/\t/g, '  ').length) / 2));
  for (const [re, type] of rules) {
    const m = line.match(re);
    if (m) {
      const nb = { id: uid(), type, text: type === 'divider' ? '' : inlineMd(line.slice(m[0].length)), indent: ['ul', 'ol', 'todo'].includes(type) ? indent : 0 };
      if (type === 'todo') nb.checked = /x/i.test(m[1] || '');
      return nb;
    }
  }
  return { id: uid(), type: 'p', text: inlineMd(line.trim()), indent: 0 };
}
function mdToBlocks(text) {
  const out = [];
  let code = null;
  let tbl = null;
  for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    if (!code && /^\s*\|.*\|\s*$/.test(line)) { (tbl = tbl || []).push(line); continue; }
    if (tbl) { out.push(Table.parseMd(tbl)); tbl = null; }
    if (/^\s*```/.test(line)) {
      if (code) { code = null; continue; }
      code = { id: uid(), type: 'code', text: '', indent: 0, lang: line.trim().slice(3).trim() };
      out.push(code);
      continue;
    }
    if (code) { code.text += (code.text ? '\n' : '') + line; continue; }
    if (!line.trim()) continue;
    out.push(parseLine(line));
  }
  if (tbl) out.push(Table.parseMd(tbl));
  return out;
}

function inlineMd(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function onPaste(e) {
  const cell = e.target.closest('.cell');
  if (cell) { const tb = blk(cell.closest('.block').dataset.id); if (tb) Table.onPaste(e, tb, cell); return; }
  const c = e.target.closest('.content[contenteditable]');
  if (!c) return;
  e.preventDefault();
  const b = blk(c.closest('.block').dataset.id);
  const files = Media.filesOf(e.clipboardData);
  if (files.length && b.type !== 'code') { readContent(b, c); Media.insertFiles(files, b.id); return; }
  const exact = b.type !== 'code' && Select.readClipboard(e.clipboardData);
  if (exact) {
    // blocs copiés depuis ReNotion : on les recrée tels quels (images, tableaux…)
    readContent(b, c);
    const p = pg();
    const i = idx(b.id);
    const empty = b.type === 'p' && !c.textContent.trim();
    p.blocks.splice(empty ? i : i + 1, empty ? 1 : 0, ...exact);
    touch(p);
    renderBlocks();
    focusBlock(exact[exact.length - 1].id, 'end');
    return;
  }
  const text = (e.clipboardData.getData('text/plain') || '').replace(/\r\n?/g, '\n');
  if (b.type === 'code') { document.execCommand('insertText', false, text); return; }
  const lines = text.split('\n');
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length <= 1) {
    const t = lines[0] || '';
    if (/^https?:\/\/\S+$/.test(t.trim()) && !getSelection().isCollapsed) document.execCommand('createLink', false, t.trim());
    else document.execCommand('insertText', false, t);
    readContent(b, c); touch(pg());
    return;
  }
  // collage multiligne : un bloc par ligne, avec détection Markdown
  const rest = htmlAfterCaret(c).replace(/<br>$/, '');
  if (b.type === 'p' && !c.textContent.length) {
    const first = parseLine(lines[0]);
    Object.assign(b, { type: first.type, text: first.text, indent: first.indent, checked: first.checked });
  } else {
    document.execCommand('insertText', false, lines[0]);
    readContent(b, c);
  }
  let lastId = b.id;
  const added = mdToBlocks(lines.slice(1).join('\n'));
  pg().blocks.splice(idx(b.id) + 1, 0, ...added);
  if (added.length) lastId = added[added.length - 1].id;
  const last = blk(lastId);
  let pos = 'end';
  if (rest) {
    if (last.type === 'code') { const nb = { id: uid(), type: 'p', text: rest, indent: 0 }; insertAfter(lastId, nb); lastId = nb.id; pos = 0; }
    else { pos = plain(last.text).length; last.text += rest; }
  }
  touch(pg());
  renderBlocks();
  focusBlock(lastId, pos);
}

function onClick(e) {
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const row = act.closest('.block');
  const b = blk(row.dataset.id);
  const p = pg();
  switch (act.dataset.act) {
    case 'check':
      b.checked = !b.checked; touch(p); renderBlocks(); break;
    case 'toggle':
      b.collapsed = !b.collapsed; touch(p); renderBlocks(); focusBlock(b.id, 'end'); break;
    case 'callout':
      b.icon = CALLOUT_ICONS[(CALLOUT_ICONS.indexOf(b.icon) + 1) % CALLOUT_ICONS.length]; touch(p); act.textContent = b.icon; break;
    case 'open':
      go(b.pageId); break;
    case 'copy':
      navigator.clipboard.writeText(b.text).then(() => toast('Code copié'), () => toast('Copie impossible'));
      break;
    case 'add': {
      const nb = insertAfter(b.id, { id: uid(), type: 'p', text: '', indent: b.indent || 0 });
      renderBlocks();
      focusBlock(nb.id, 0);
      const c = $(`.block[data-id="${nb.id}"] .content`);
      document.execCommand('insertText', false, '/');
      readContent(nb, c);
      slash = { id: nb.id, start: 0 };
      openSlash();
      break;
    }
    case 'menu':
      blockMenu(b, act); break;
    case 'tbl-row': case 'tbl-col':
      Table.onAction(act.dataset.act, b); break;
    case 'media-width': case 'media-preview': case 'media-text': case 'media-open':
      Media.onAction(act.dataset.act, b); break;
    case 'toc-go':
      e.preventDefault(); Extras.goTo(act.dataset.target); break;
  }
}

/* ---------- Menu « / » ---------- */

let slashSel = 0;
let slashItems = [];

function slashQuery() {
  const c = $(`.block[data-id="${slash.id}"] .content`);
  if (!c) return null;
  const off = caretOffset(c);
  if (off <= slash.start || c.textContent[slash.start] !== '/') return null;
  return c.textContent.slice(slash.start + 1, off);
}
function norm(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function openSlash() { slashSel = 0; updateSlash(); }
function updateSlash() {
  const q = slashQuery();
  if (q == null || q.length > 24 || /\s{2}/.test(q)) return closeSlash();
  const nq = norm(q.trim());
  const gi = (t) => SLASH_GROUPS.indexOf(t.group || 'Blocs de base');
  slashItems = Object.entries(TYPES).filter(([k, t]) => !nq || norm(t.label + ' ' + t.keys).includes(nq))
    .sort((x, y) => gi(x[1]) - gi(y[1]));
  if (!slashItems.length && q.length > 3) return closeSlash();
  slashSel = Math.min(slashSel, Math.max(0, slashItems.length - 1));
  const pop = h('div', { class: 'pop', id: 'slash' });
  if (!slashItems.length) pop.append(h('div', { class: 'empty-res' }, 'Aucun résultat'));
  let lastGroup = null;
  slashItems.forEach(([k, t], i) => {
    const g = t.group || 'Blocs de base';
    if (g !== lastGroup) { pop.append(h('div', { class: 'hdr' }, g)); lastGroup = g; }
    pop.append(h('button', {
    class: 'item big' + (i === slashSel ? ' sel' : ''),
    onmousedown: (e) => { e.preventDefault(); pickSlash(k); },
    onmousemove: () => { if (slashSel !== i) { slashSel = i; highlightSlash(); } },
  }, h('span', { class: 'ic' }, t.icon), h('span', {}, h('div', {}, t.label), h('div', { class: 'd' }, t.desc))));
  });
  const r = caretRect() || $(`.block[data-id="${slash.id}"]`).getBoundingClientRect();
  showPop(pop, { left: r.left, top: r.bottom + 4, bottomAlt: r.top - 4 }, true);
  highlightSlash();
}
function highlightSlash() {
  const items = document.querySelectorAll('#slash .item');
  items.forEach((x, i) => x.classList.toggle('sel', i === slashSel));
  if (items[slashSel]) items[slashSel].scrollIntoView({ block: 'nearest' });
}
function closeSlash() { slash = null; const s = $('#slash'); if (s) s.remove(); }
function slashKey(e) {
  if (!$('#slash')) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = slashItems.length || 1;
    slashSel = (slashSel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    highlightSlash();
    return true;
  }
  if ((e.key === 'Enter' || e.key === 'Tab') && slashItems.length) { e.preventDefault(); pickSlash(slashItems[slashSel][0]); return true; }
  if (e.key === 'Escape') { e.preventDefault(); closeSlash(); return true; }
  return false;
}
function pickSlash(type) {
  const { id, start } = slash;
  closeSlash();
  const b = blk(id);
  const c = $(`.block[data-id="${id}"] .content`);
  const off = caretOffset(c);
  rangeOf(c, start, off >= start ? off : start + 1).deleteContents();
  readContent(b, c);
  if (type === 'ai') { touch(pg()); return AI.open(id); }
  if (type === 'askspace') { touch(pg()); return AI.open(id, { scope: 'space' }); }
  if (type === 'mistral') { touch(pg()); return AI.open(id, { engine: 'mistral' }); }
  if (type === 'think') { touch(pg()); return AI.open(id, { engine: 'reflexion' }); }
  if (type === 'template') { touch(pg()); return Extras.pickTemplate(id); }
  if (type === 'dictate') { touch(pg()); return Extras.dictate(id); }
  if (type === 'date') { setCaret(c, start); document.execCommand('insertText', false, Extras.dateLong() + ' '); readContent(b, c); touch(pg()); return; }
  if (type === 'image' || type === 'file') { touch(pg()); return Media.pick(type, id); }
  if (!c.textContent.trim() || type === 'divider') {
    if (type === 'divider' && c.textContent.trim()) {
      const nb = insertAfter(id, { id: uid(), type: 'divider', text: '', indent: b.indent || 0 });
      return turnInto(nb, 'divider');
    }
    b.text = '';
    return turnInto(b, type);
  }
  const nb = insertAfter(id, { id: uid(), type: 'p', text: '', indent: b.indent || 0 });
  turnInto(nb, type);
}

/* ---------- Popovers & menus ---------- */

function closePop() {
  slash = null;
  if (typeof AI !== 'undefined') AI.stop();
  $('#layer').innerHTML = '';
}
function showPop(pop, pos, keep) {
  if (!keep) closePop();
  else { const old = pop.id && document.getElementById(pop.id); if (old) old.remove(); }
  $('#layer').append(pop);
  const w = pop.offsetWidth;
  const hgt = pop.offsetHeight;
  let left = Math.min(pos.left, innerWidth - w - 8);
  let top = pos.top;
  if (top + hgt > innerHeight - 8) top = pos.bottomAlt != null ? pos.bottomAlt - hgt : innerHeight - hgt - 8;
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top = Math.max(8, top) + 'px';
}
function menu(anchor, items) {
  const pop = h('div', { class: 'pop' });
  items.filter(Boolean).forEach((it) => {
    if (it === '-') pop.append(h('div', { class: 'sep' }));
    else if (it.header) pop.append(h('div', { class: 'hdr' }, it.header));
    else pop.append(h('button', { class: 'item' + (it.danger ? ' danger' : ''), onclick: () => { closePop(); it.action(); } },
      h('span', { class: 'ic' }, it.icon || ''), h('span', {}, it.label), it.right ? h('span', { class: 'r' }, it.right) : null));
  });
  const r = anchor.getBoundingClientRect();
  showPop(pop, { left: r.left, top: r.bottom + 4, bottomAlt: r.top - 4 });
}

function blockMenu(b, anchor) {
  anchor.closest('.handle').classList.add('show');
  if (Select.size() > 1 && Select.includes(b.id)) return menu(anchor, Select.menuItems());
  const items = [
    { icon: '🗑', label: 'Supprimer', right: 'Suppr', danger: true, action: () => deleteBlock(b.id) },
    { icon: '⧉', label: 'Dupliquer', right: 'Ctrl+D', action: () => duplicateBlock(b.id) },
    { icon: '↑', label: 'Monter', right: 'Ctrl+Maj+↑', action: () => shiftBlock(b.id, -1) },
    { icon: '↓', label: 'Descendre', right: 'Ctrl+Maj+↓', action: () => shiftBlock(b.id, 1) },
  ];
  if (b.type !== 'divider') items.push({ icon: '✨', label: 'Demander à l’IA', right: 'Ctrl+J', action: () => AI.open(b.id) });
  if (b.type === 'code') items.push({ icon: '⌘', label: 'Langage…', action: () => { const l = prompt('Langage', b.lang || ''); if (l != null) { b.lang = l.trim(); touch(pg()); renderBlocks(); } } });
  if (b.type === 'table') {
    const lc = lastCell && lastCell.id === b.id ? lastCell : { r: 0, c: 0 };
    items.push('-', ...Table.cellMenu(b, Math.min(lc.r, b.rows.length - 1), Math.min(lc.c, b.rows[0].length - 1)));
  }
  if (Media.isMedia(b)) items.push({ icon: '🔁', label: 'Remplacer le fichier…', action: () => { Media.pick(b.type, b.id, { replaceEmpty: false }); deleteBlock(b.id); } });
  if (b.type !== 'page' && b.type !== 'divider' && b.type !== 'table' && b.type !== 'toc' && !Media.isMedia(b)) {
    items.push('-', { header: 'Transformer en' });
    TEXT_TYPES.concat(['table', 'page']).forEach((t) => { if (t !== b.type) items.push({ icon: TYPES[t].icon, label: TYPES[t].label, action: () => turnInto(b, t) }); });
  }
  menu(anchor, items);
}

function pageMenu(p, anchor) {
  const st = isFolder(p) ? null : Extras.stats(p);
  menu(anchor, [
    st ? { header: `${st.words.toLocaleString('fr-FR')} mot${st.words > 1 ? 's' : ''} · ${st.minutes} min de lecture · ${st.blocks} blocs` } : null,
    { icon: isFav(p) ? '★' : '☆', label: isFav(p) ? 'Retirer des favoris' : 'Ajouter aux favoris', action: () => { toggleFav(p); render(); } },
    { icon: '＋', label: isFolder(p) ? 'Nouvelle page dans le dossier' : 'Ajouter une sous-page', action: () => go(newPage(p.id).id, true) },
    { icon: '📁', label: 'Nouveau dossier à l’intérieur', action: () => go(newFolder(p.id).id, true) },
    { icon: '✏️', label: 'Renommer', action: () => { const t = prompt('Nouveau nom', p.title); if (t != null) { p.title = t.trim(); touch(p); render(); } } },
    { icon: '⧉', label: 'Dupliquer', action: () => go(duplicatePage(p).id) },
    { icon: '↗', label: 'Déplacer vers…', action: () => movePicker(p) },
    isFolder(p) ? null : { icon: '🧩', label: 'Appliquer un modèle…', action: () => { go(p.id); Extras.pickTemplate(null); } },
    isFolder(p) ? null : { icon: '🕘', label: 'Historique des versions', action: () => Versions.open(p) },
    isFolder(p) ? null : { icon: '⬇', label: 'Exporter en Markdown', action: () => download(`${safeName(titleOf(p))}.md`, toMarkdown(p), 'text/markdown') },
    '-',
    { icon: '🗑', label: 'Mettre à la corbeille', danger: true, action: () => trashPage(p) },
  ]);
}

function emojiPicker(anchor, cb, allowRemove) {
  const grid = h('div', { class: 'emoji-grid' }, EMOJIS.map((em) => h('button', { onclick: () => { closePop(); cb(em); } }, em)));
  const pop = h('div', { class: 'pop' }, h('div', { class: 'hdr' }, 'Icône'), grid,
    allowRemove ? h('button', { class: 'item danger', onclick: () => { closePop(); cb(''); } }, h('span', { class: 'ic' }, '✕'), 'Retirer l’icône') : null);
  const r = anchor.getBoundingClientRect();
  showPop(pop, { left: r.left, top: r.bottom + 4 });
}
function coverPicker(p, anchor) {
  const pop = h('div', { class: 'pop' }, h('div', { class: 'hdr' }, 'Couverture'),
    h('div', { class: 'cover-grid' }, COVERS.map((cv) => h('button', { style: { background: cv }, onclick: () => { closePop(); p.cover = cv; touch(p); renderPage(); } }))));
  const r = anchor.getBoundingClientRect();
  showPop(pop, { left: r.left - 200, top: r.bottom + 4 });
}

/* ---------- Actions sur les pages ---------- */

function duplicatePage(p) {
  const map = {};
  const clone = (src, parentId) => {
    const id = uid();
    map[src.id] = id;
    S.pages[id] = { ...JSON.parse(JSON.stringify(src)), id, parentId, createdAt: Date.now(), updatedAt: Date.now() };
    childrenOf(src.id).forEach((k) => clone(k, id));
    return S.pages[id];
  };
  const copy = clone(p, p.parentId);
  copy.title = titleOf(p) + ' (copie)';
  copy.pos = p.pos + 0.5;
  Object.values(map).forEach((nid) => S.pages[nid].blocks.forEach((b) => { if (b.type === 'page' && map[b.pageId]) b.pageId = map[b.pageId]; b.id = uid(); }));
  save();
  return copy;
}
function trashPage(p) {
  p.trashed = true;
  p.trashedAt = Date.now();
  save();
  toast(`« ${titleOf(p)} » déplacée dans la corbeille`, 'Annuler', () => { p.trashed = false; save(); go(p.id); });
  if (current === p.id || isDeleted(S.pages[current])) {
    const parent = S.pages[p.parentId];
    current = parent && !isDeleted(parent) ? parent.id : null;
    if (current) history.replaceState(null, '', '#/' + current);
  }
  render();
}
function movePicker(p) {
  const bad = new Set([p.id, ...descendants(p.id).map((x) => x.id)]);
  const opts = Object.values(S.pages).filter((x) => !bad.has(x.id) && !isDeleted(x));
  const list = [{ id: null, label: 'Racine (aucun parent)', icon: '🏠' }, ...opts.map((x) => ({ id: x.id, label: [...ancestors(x), x].map(titleOf).join(' / '), icon: iconOf(x) }))];
  palette('Déplacer vers…', list, (it) => {
    p.parentId = it.id;
    const sib = childrenOf(it.id).filter((x) => x.id !== p.id);
    p.pos = sib.length ? sib[sib.length - 1].pos + 1 : 0;
    if (it.id) UI.expanded[it.id] = true;
    saveUI(); touch(p); render();
  });
}

/* ---------- Palette (recherche, déplacement) ---------- */

function palette(placeholder, source, onPick) {
  closePop();
  const input = h('input', { type: 'text', placeholder, 'aria-label': placeholder });
  const list = h('div', { class: 'list' });
  let sel = 0;
  let res = [];
  const draw = () => {
    const q = input.value;
    res = typeof source === 'function' ? source(q) : source.filter((x) => norm(x.label).includes(norm(q)));
    sel = Math.min(sel, Math.max(0, res.length - 1));
    list.innerHTML = '';
    if (!res.length) list.append(h('div', { class: 'empty-res' }, 'Aucun résultat'));
    res.slice(0, 50).forEach((it, i) => list.append(h('button', {
      class: 'item' + (i === sel ? ' sel' : ''), onclick: () => { closePop(); onPick(it); }, onmousemove: () => { sel = i; mark(); },
    }, h('span', { class: 'ic' }, it.icon), h('span', { style: { minWidth: 0, flex: 1 } }, h('div', {}, it.label), it.snip ? h('div', { class: 'snip' }, it.snip) : null))));
  };
  const mark = () => list.querySelectorAll('.item').forEach((x, i) => { x.classList.toggle('sel', i === sel); if (i === sel) x.scrollIntoView({ block: 'nearest' }); });
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, res.length - 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); mark(); }
    else if (e.key === 'Enter' && res[sel]) { e.preventDefault(); closePop(); onPick(res[sel]); }
    else if (e.key === 'Escape') closePop();
  });
  const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) closePop(); } }, h('div', { class: 'modal' }, input, list));
  $('#layer').append(back);
  draw();
  input.focus();
}

function openSearch() {
  palette('Rechercher dans ReNotion…', (q) => {
    const nq = norm(q.trim());
    const pages = Object.values(S.pages).filter((p) => !isDeleted(p));
    const out = [];
    for (const p of pages) {
      const path = ancestors(p).map(titleOf).join(' / ');
      if (!nq) { out.push({ id: p.id, icon: iconOf(p), label: titleOf(p), snip: path, score: -p.updatedAt }); continue; }
      if (norm(titleOf(p)).includes(nq)) { out.push({ id: p.id, icon: iconOf(p), label: titleOf(p), snip: path, score: 0 }); continue; }
      const hit = p.blocks.map((b) => (b.type === 'code' ? b.text : b.type === 'table' ? Table.plainText(b) : Media.isMedia(b) ? b.name || '' : plain(b.text))).find((t) => norm(t).includes(nq));
      if (hit) {
        const i = norm(hit).indexOf(nq);
        out.push({ id: p.id, icon: iconOf(p), label: titleOf(p), snip: (i > 30 ? '…' : '') + hit.slice(Math.max(0, i - 30), i + 60), score: 1 });
      }
    }
    return out.sort((a, b) => a.score - b.score);
  }, (it) => go(it.id));
}

/* ---------- Corbeille & paramètres ---------- */

function modal(title, bodyFn) {
  closePop();
  const body = h('div', { class: 'body' }, h('h2', {}, title));
  const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) closePop(); } }, h('div', { class: 'modal' }, body));
  $('#layer').append(back);
  bodyFn(body);
  return body;
}

function openTrash() {
  modal('Corbeille', (body) => {
    const list = h('div');
    const draw = () => {
      list.innerHTML = '';
      const items = Object.values(S.pages).filter((p) => p.trashed).sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
      if (!items.length) list.append(h('p', {}, 'La corbeille est vide.'));
      items.forEach((p) => list.append(h('div', { class: 'trash-row' },
        h('span', {}, iconOf(p)), h('span', { class: 'name' }, titleOf(p)),
        h('button', { class: 'btn', onclick: () => {
          p.trashed = false;
          if (p.parentId && (!S.pages[p.parentId] || isDeleted(S.pages[p.parentId]))) p.parentId = null;
          save(); renderSidebar(); draw(); toast('Page restaurée');
        } }, 'Restaurer'),
        h('button', { class: 'btn danger', onclick: () => {
          if (!confirm(`Supprimer définitivement « ${titleOf(p)} » et ses sous-pages ?`)) return;
          [p, ...descendants(p.id)].forEach((x) => delete S.pages[x.id]);
          save(); draw();
        } }, 'Supprimer'))));
      if (items.length) list.append(h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn danger', onclick: () => {
        if (!confirm('Vider définitivement la corbeille ?')) return;
        items.forEach((p) => [p, ...descendants(p.id)].forEach((x) => delete S.pages[x.id]));
        save(); draw();
      } }, 'Vider la corbeille')));
    };
    body.append(list);
    draw();
  });
}

function openSettings() {
  modal('Paramètres', (body) => {
    const seg = h('div', { class: 'seg' }, [['auto', 'Système'], ['light', 'Clair'], ['dark', 'Sombre']].map(([v, l]) =>
      h('button', { class: UI.theme === v ? 'on' : '', onclick: (e) => { UI.theme = v; applyTheme(); saveUI(); seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, l)));
    const count = Object.keys(S.pages).length;
    let size = 0;
    try { size = (localStorage.getItem(LS_KEY) || '').length; } catch (e) { /* ignore */ }
    if (CLOUD) Cloud.settings(body);
    body.append(
      h('p', {}, 'Thème'), seg,
      h('p', {}, h('label', {}, h('input', { type: 'checkbox', checked: UI.wide, onchange: (e) => { UI.wide = e.target.checked; applyTheme(); saveUI(); } }), ' Pleine largeur')),
      h('p', {}, CLOUD ? `${count} pages dans cet espace, synchronisées en ligne. Tu peux aussi en exporter une copie :` : `Tes données (${count} pages, ${(size / 1024).toFixed(0)} Ko) sont stockées uniquement dans ce navigateur. Exporte régulièrement une sauvegarde.`),
      h('button', { class: 'btn primary', onclick: () => download(`renotion-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(S, null, 1), 'application/json') }, 'Exporter (JSON)'),
      h('button', { class: 'btn', onclick: () => $('#file-import').click() }, 'Importer une sauvegarde'),
      h('button', { class: 'btn', onclick: () => importMarkdown() }, 'Importer du Markdown'),
      h('button', { class: 'btn', onclick: () => { closePop(); Media.importPdf(); } }, 'Importer un PDF'),
      h('p', { style: { marginTop: '14px' } }, 'Raccourcis : Ctrl+K recherche · Ctrl+B/I/U gras/italique/souligné · Ctrl+E code · Ctrl+Maj+X barré · Ctrl+K sur une sélection = lien · Ctrl+D dupliquer · Ctrl+Maj+↑/↓ déplacer · Ctrl+\\ barre latérale'));
  });
}

function importMarkdown() {
  const inp = h('input', { type: 'file', accept: '.md,.markdown,.txt,text/markdown,text/plain', multiple: true });
  inp.addEventListener('change', async () => {
    let lastId;
    for (const f of inp.files) {
      const text = (await f.text()).replace(/\r\n?/g, '\n');
      const p = newPage(null, f.name.replace(/\.(md|markdown|txt)$/i, ''));
      p.blocks = mdToBlocks(text);
      if (p.blocks[0] && p.blocks[0].type === 'h1') p.title = plain(p.blocks.shift().text).trim();
      if (!p.blocks.length) p.blocks.push({ id: uid(), type: 'p', text: '', indent: 0 });
      lastId = p.id;
    }
    save();
    if (lastId) { go(lastId); toast(`${inp.files.length} fichier(s) importé(s)`); }
  });
  inp.click();
}

$('#file-import').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || typeof d.pages !== 'object') throw new Error('format');
    for (const p of Object.values(d.pages)) {
      if (!p.id || !Array.isArray(p.blocks)) throw new Error('format');
      p.title = String(p.title || '');
      p.blocks.forEach((b) => { if (!TYPES[b.type] || PSEUDO_TYPES.has(b.type)) b.type = 'p'; b.text = String(b.text || ''); });
    }
    const replace = confirm(CLOUD
      ? 'OK : remplacer TOUTES les pages de l’espace (pour tous les membres).\nAnnuler : ajouter les pages importées à l’espace.'
      : 'OK : remplacer toutes les pages actuelles.\nAnnuler : fusionner avec les pages actuelles.');
    const pages = freshIds(d.pages);
    if (replace) S.pages = pages;
    else Object.assign(S.pages, pages);
    save();
    current = null;
    render();
    toast('Sauvegarde importée');
  } catch (err) {
    toast('Fichier invalide : ce n’est pas une sauvegarde ReNotion');
  }
});

function freshIds(pages) {
  const map = {};
  Object.keys(pages).forEach((id) => { map[id] = uid(); });
  const out = {};
  Object.values(pages).forEach((p) => {
    const np = { ...p, id: map[p.id], parentId: p.parentId && map[p.parentId] ? map[p.parentId] : null };
    if (p.favorite) UI.favs[np.id] = true;
    delete np.favorite;
    np.blocks = p.blocks.map((b) => {
      const nb = { ...b, id: uid() };
      delete nb.pos;
      if (b.type === 'page') nb.pageId = map[b.pageId] || b.pageId;
      return nb;
    });
    out[np.id] = np;
  });
  saveUI();
  return out;
}

/* ---------- Export Markdown ---------- */

function htmlToMd(html) {
  const t = document.createElement('template');
  t.innerHTML = sanitize(html);
  const walk = (n) => [...n.childNodes].map((x) => {
    if (x.nodeType === 3) return x.textContent;
    const inner = walk(x);
    switch (x.tagName) {
      case 'B': return `**${inner}**`;
      case 'I': return `*${inner}*`;
      case 'S': return `~~${inner}~~`;
      case 'CODE': return '`' + inner + '`';
      case 'A': return `[${inner}](${x.getAttribute('href')})`;
      case 'BR': return '  \n';
      default: return inner;
    }
  }).join('');
  return walk(t.content);
}
function toMarkdown(p) {
  return `# ${p.icon ? p.icon + ' ' : ''}${titleOf(p)}\n\n` + mdOfBlocks(p.blocks);
}
function mdOfBlocks(blocks) {
  const out = [];
  const counters = [];
  blocks.forEach((b) => {
    const ind = '  '.repeat(b.indent || 0);
    const t = b.type === 'code' ? b.text : htmlToMd(b.text);
    counters.length = (b.indent || 0) + 1;
    switch (b.type) {
      case 'h1': out.push(`## ${t}`, ''); break;
      case 'h2': out.push(`### ${t}`, ''); break;
      case 'h3': out.push(`#### ${t}`, ''); break;
      case 'ul': case 'toggle': out.push(`${ind}- ${t}`); break;
      case 'ol': counters[b.indent || 0] = (counters[b.indent || 0] || 0) + 1; out.push(`${ind}${counters[b.indent || 0]}. ${t}`); break;
      case 'todo': out.push(`${ind}- [${b.checked ? 'x' : ' '}] ${t}`); break;
      case 'quote': out.push(`> ${t}`, ''); break;
      case 'callout': out.push(`> ${b.icon || '💡'} ${t}`, ''); break;
      case 'code': out.push('```' + (b.lang || ''), t, '```', ''); break;
      case 'divider': out.push('---', ''); break;
      case 'page': out.push(`${ind}📄 ${titleOf(S.pages[b.pageId])}`, ''); break;
      case 'table': out.push(Table.toMd(b), ''); break;
      case 'image': out.push(`![${b.name || 'image'}](${b.name || 'image'})`, ''); break;
      case 'file': out.push(`📎 ${b.name || 'fichier'}`, ''); break;
      case 'toc': break;
      default: out.push(ind + t, '');
    }
    if (b.type !== 'ol') counters[b.indent || 0] = 0;
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
const safeName = (s) => s.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Divers ---------- */

let toastTimer;
function toast(msg, actionLabel, action) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast', role: 'status' }, msg,
    actionLabel ? h('button', { style: { marginLeft: '12px', fontWeight: 600, color: 'inherit', textDecoration: 'underline' }, onclick: () => { t.remove(); action(); } }, actionLabel) : null);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 5000);
}
function applyTheme() {
  if (UI.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = UI.theme;
  document.body.classList.toggle('wide', !!UI.wide);
}
function setSidebar(show) {
  UI.sbHidden = !show;
  document.body.classList.toggle('sb-hidden', UI.sbHidden);
  saveUI();
}

/* ---------- Démarrage ---------- */

loadUI();
applyTheme();
document.body.classList.toggle('sb-hidden', UI.sbHidden || innerWidth <= 760);

$('#btn-today').addEventListener('click', () => Extras.openToday());
Radio.init();
$('#btn-new').addEventListener('click', () => { go(newPage(null).id, true); if (innerWidth <= 760) setSidebar(false); });
$('#btn-new2').addEventListener('click', () => { go(newPage(null).id, true); if (innerWidth <= 760) setSidebar(false); });
$('#btn-folder').addEventListener('click', () => { go(newFolder(null).id, true); });
bindTreeDnd($('#tree'), '.tree-row');
$('#btn-search').addEventListener('click', openSearch);
$('#btn-trash').addEventListener('click', openTrash);
$('#btn-settings').addEventListener('click', openSettings);
$('#sb-close').addEventListener('click', () => setSidebar(false));
$('#sb-open').addEventListener('click', () => setSidebar(document.body.classList.contains('sb-hidden')));
$('#scrim').addEventListener('click', () => setSidebar(false));
$('#btn-fav').addEventListener('click', () => { const p = S.pages[current]; if (!p) return; toggleFav(p); renderSidebar(); renderTop(); });
$('#btn-more').addEventListener('click', (e) => { const p = S.pages[current]; if (p) pageMenu(p, e.currentTarget); });
$('#btn-ai').addEventListener('click', () => AI.open(null));
$('#btn-undo').addEventListener('click', () => History.undo(current));
$('#btn-redo').addEventListener('click', () => History.redo(current));

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'p') && getSelection().isCollapsed) { e.preventDefault(); openSearch(); }
  else if (mod && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y') && !e.target.closest('.modal, #ai, input, textarea, select')) {
    e.preventDefault();
    if (e.key.toLowerCase() === 'y' || e.shiftKey) History.redo(current); else History.undo(current);
  }
  else if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); const row = document.activeElement && document.activeElement.closest && document.activeElement.closest('.block'); AI.open(row ? row.dataset.id : null); }
  else if (mod && e.key === '\\') { e.preventDefault(); setSidebar(document.body.classList.contains('sb-hidden')); }
  else if (e.key === 'Escape' && $('#layer').children.length) closePop();
});
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.pop') && !e.target.closest('.modal-back') && !e.target.closest('[data-act="menu"]') && !e.target.closest('#btn-radio')) {
    document.querySelectorAll('.pop').forEach((p) => p.remove());
    slash = null;
    document.querySelectorAll('.handle.show').forEach((x) => x.classList.remove('show'));
  }
});
document.addEventListener('selectionchange', () => { if (slash && document.activeElement && !document.activeElement.closest(`.block[data-id="${slash.id}"]`)) closeSlash(); });
window.addEventListener('popstate', () => { current = location.hash.slice(2) || null; render(); });
window.addEventListener('storage', (e) => { if (!CLOUD && e.key === LS_KEY && e.newValue) { try { S = JSON.parse(e.newValue); render(); } catch (err) { /* ignore */ } } });

function startApp() {
  current = location.hash.slice(2) || null;
  if (!S.pages[current]) current = (childrenOf(null)[0] || {}).id || null;
  if (current && location.hash !== '#/' + current) history.replaceState(null, '', '#/' + current);
  render();
}

if (CLOUD) Cloud.boot();
else { load(); startApp(); save(); }
