'use strict';

/* Petits plus : modèles de pages, page du jour (journal), sommaire, dictée vocale, date, compteur de mots. */

const Extras = (() => {
  const today = () => new Date();
  const dateLong = (d = today()) => {
    const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  /* ---------- Modèles ---------- */

  const TEMPLATES = [
    { key: 'reunion', icon: '🗓', name: 'Compte rendu de réunion', md: () => `## Infos\n- **Date** : ${dateLong()}\n- **Participants** : \n- **Objectif** : \n\n## Ordre du jour\n1. \n2. \n3. \n\n## Notes\n- \n\n## Décisions\n- \n\n## Prochaines actions\n- [ ] Action — responsable — échéance\n- [ ] ` },
    { key: 'projet', icon: '🚀', name: 'Projet', md: () => `> 🎯 **Objectif** : décris en une phrase ce que le projet doit accomplir.\n\n## Contexte\n\n## Étapes\n| Étape | Responsable | Échéance | Statut |\n| --- | --- | --- | --- |\n| Cadrage |  |  | À faire |\n| Réalisation |  |  | À faire |\n| Bilan |  |  | À faire |\n\n## Tâches\n- [ ] \n\n## Ressources\n- \n\n## Questions ouvertes\n- ` },
    { key: 'voyage', icon: '✈️', name: 'Voyage', md: () => `## Infos pratiques\n- **Dates** : \n- **Destination** : \n- **Qui vient** : \n\n## Budget\n| Poste | Prévu | Réel |\n| --- | --- | --- |\n| Transport |  |  |\n| Logement |  |  |\n| Nourriture |  |  |\n| Activités |  |  |\n\n## Programme\n- **Jour 1** : \n- **Jour 2** : \n\n## À emporter\n- [ ] Papiers d’identité\n- [ ] Chargeurs\n- [ ] Trousse de toilette\n\n## Idées d’activités\n- ` },
    { key: 'journal', icon: '📔', name: 'Journal du jour', md: () => `## 🌅 Intentions du jour\n- [ ] \n- [ ] \n- [ ] \n\n## 📝 Notes\n\n## 🙏 Trois choses positives\n1. \n2. \n3. \n\n## 🌙 Bilan\n` },
    { key: 'cours', icon: '🎓', name: 'Notes de cours', md: () => `- **Matière** : \n- **Date** : ${dateLong()}\n\n## Idées clés\n- \n\n## Définitions\n| Terme | Définition |\n| --- | --- |\n|  |  |\n\n## Questions à revoir\n- [ ] \n\n## Résumé\n` },
    { key: 'recette', icon: '🍳', name: 'Recette', md: () => `- **Pour** : 4 personnes\n- **Préparation** : \n- **Cuisson** : \n\n## Ingrédients\n- [ ] \n- [ ] \n\n## Étapes\n1. \n2. \n3. \n\n> 💡 Astuce : ` },
    { key: 'hebdo', icon: '📆', name: 'Planning de la semaine', md: () => `| Jour | Priorités | Rendez-vous |\n| --- | --- | --- |\n| Lundi |  |  |\n| Mardi |  |  |\n| Mercredi |  |  |\n| Jeudi |  |  |\n| Vendredi |  |  |\n| Week-end |  |  |\n\n## Objectifs de la semaine\n- [ ] \n- [ ] ` },
    { key: 'idees', icon: '💡', name: 'Boîte à idées', md: () => `> Note ici toutes les idées, même les plus folles. On trie après.\n\n| Idée | Proposée par | Intérêt | Effort |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n## Idées retenues\n- ` },
  ];

  const isBlank = (p) => p.blocks.every((b) => b.type === 'p' && !plain(b.text).trim());

  function applyTemplate(t, p = pg(), atId = null) {
    if (!p || isFolder(p)) return;
    const blocks = mdToBlocks(t.md());
    if (isBlank(p)) {
      p.blocks = blocks.length ? blocks : [{ id: uid(), type: 'p', text: '', indent: 0 }];
      if (!p.title.trim()) p.title = t.key === 'journal' ? dateLong() : t.name;
      if (!p.icon) p.icon = t.icon;
    } else {
      let i = atId ? p.blocks.findIndex((b) => b.id === atId) : p.blocks.length - 1;
      const ref = p.blocks[i];
      if (ref && ref.type === 'p' && !plain(ref.text).trim()) p.blocks.splice(i, 1, ...blocks);
      else p.blocks.splice(i + 1, 0, ...blocks);
    }
    touch(p);
    render();
  }

  function pickTemplate(atId) {
    palette('Choisir un modèle…', TEMPLATES.map((t) => ({ id: t.key, icon: t.icon, label: t.name, t })), (it) => applyTemplate(it.t, pg(), atId));
  }

  // Suggestions affichées sur une page vide
  function hints(p) {
    if (!p || isFolder(p) || !isBlank(p)) return null;
    return h('div', { class: 'tpl-hints' },
      h('span', { class: 'muted' }, 'Commencer avec un modèle :'),
      TEMPLATES.slice(0, 5).map((t) => h('button', { class: 'chip', onclick: () => applyTemplate(t, p) }, `${t.icon} ${t.name}`)),
      h('button', { class: 'chip', onclick: () => pickTemplate(null) }, 'Plus…'),
      CLOUD ? h('button', { class: 'chip', onclick: () => AI.open(p.blocks[0] && p.blocks[0].id) }, '✨ Écrire avec l’IA') : null);
  }

  /* ---------- Page du jour ---------- */

  function openToday() {
    let folder = childrenOf(null).find((x) => isFolder(x) && /^journal$/i.test(x.title.trim()));
    if (!folder) { folder = newPage(null, 'Journal', 'folder'); folder.icon = '📔'; }
    const title = dateLong();
    let page = childrenOf(folder.id).find((x) => x.title.trim() === title);
    if (!page) {
      page = newPage(folder.id, title);
      page.icon = '📝';
      page.blocks = mdToBlocks(TEMPLATES.find((t) => t.key === 'journal').md());
      // les journaux les plus récents en haut
      const sib = childrenOf(folder.id).filter((x) => x.id !== page.id);
      page.pos = sib.length ? sib[0].pos - 1 : 0;
      UI.expanded[folder.id] = true;
      saveUI();
      touch(page);
    }
    go(page.id);
    if (innerWidth <= 760) setSidebar(false);
  }

  /* ---------- Sommaire ---------- */

  function tocItems(p) {
    return p.blocks.filter((b) => /^h[123]$/.test(b.type) && plain(b.text).trim()).map((b) => ({ id: b.id, level: +b.type[1], text: plain(b.text).trim() }));
  }

  function renderToc(p) {
    const items = tocItems(p);
    return h('div', { class: 'content toc' },
      items.length
        ? items.map((it) => h('a', { class: 'toc-item lvl' + it.level, href: '#', 'data-act': 'toc-go', 'data-target': it.id }, it.text))
        : h('span', { class: 'muted' }, 'Le sommaire liste automatiquement les titres de la page.'));
  }

  function refreshToc() {
    const p = pg();
    if (!p) return;
    document.querySelectorAll('#blocks > .block[data-type="toc"] .toc').forEach((el) => el.replaceWith(renderToc(p)));
  }

  function goTo(id) {
    const row = $(`.block[data-id="${id}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'start' });
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1200);
  }

  /* ---------- Dictée vocale ---------- */

  let rec = null;
  function dictate(blockId) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('La dictée vocale n’est pas disponible dans ce navigateur (essaie Chrome ou Edge)'); return; }
    if (rec) { rec.stop(); return; }
    const p = pg();
    let target = blk(blockId);
    if (!target) return;
    rec = new SR();
    rec.lang = 'fr-FR';
    rec.continuous = true;
    rec.interimResults = true;
    const live = h('span', { class: 'dict-live' });
    const pill = h('button', { class: 'dict-pill', title: 'Arrêter la dictée', onclick: () => rec && rec.stop() }, h('span', { class: 'dict-dot' }), 'Dictée en cours… ', live, h('b', {}, ' Arrêter'));
    document.body.append(pill);
    const write = (text) => {
      const row = $(`.block[data-id="${target.id}"]`);
      const c = row && row.querySelector('.content[contenteditable]');
      if (!c) return;
      if (document.activeElement !== c) setCaret(c, 'end');
      const before = c.textContent;
      document.execCommand('insertText', false, (before && !/\s$/.test(before) ? ' ' : '') + text);
      readContent(target, c);
      touch(p);
    };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) write(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      live.textContent = interim ? '« ' + interim.trim() + ' »' : '';
    };
    rec.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Dictée : ' + (e.error === 'not-allowed' ? 'micro refusé' : e.error)); };
    rec.onend = () => { rec = null; pill.remove(); };
    try { rec.start(); } catch (e) { rec = null; pill.remove(); toast('Impossible de lancer la dictée'); }
  }

  /* ---------- Statistiques ---------- */

  function stats(p) {
    const text = p.blocks.map((b) => b.type === 'table' ? Table.plainText(b) : b.type === 'code' ? b.text : plain(b.text)).join(' ');
    const words = (text.match(/[\p{L}\p{N}’'-]+/gu) || []).length;
    const minutes = Math.max(1, Math.round(words / 230));
    return { words, minutes, blocks: p.blocks.length };
  }

  return { TEMPLATES, applyTemplate, pickTemplate, hints, openToday, renderToc, refreshToc, goTo, dictate, dateLong, stats };
})();
