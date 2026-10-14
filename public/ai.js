'use strict';

/* Assistant IA (Groq via la fonction Supabase « ai »), façon Notion AI. */

const AI = (() => {
  let ctrl = null;

  const SYSTEM = [
    'Tu es l’assistant d’écriture intégré à ReNotion, un éditeur de notes par blocs.',
    'Réponds uniquement avec le contenu demandé, prêt à être inséré dans la page : pas de phrase d’introduction ni de conclusion du type « Voici… ».',
    'Formate en Markdown simple : titres (#, ##, ###), listes (-), listes numérotées (1.), cases à cocher (- [ ]), citations (>), **gras**, *italique*, `code`, blocs ```.',
    'Tu peux utiliser des tableaux Markdown (| col | col | puis | --- | --- |) quand c’est utile : ils deviennent de vrais tableaux dans la page.',
    'Quand le texte ciblé est un tableau, réponds avec le tableau complet mis à jour en Markdown (toutes les lignes, en-tête compris), sauf si on te demande autre chose.',
    'Réponds dans la langue du texte fourni (celle de la page ou du tableau, y compris pour les noms propres traduisibles), sauf si l’instruction demande une autre langue.',
  ].join(' ');

  const TEXT_ACTIONS = [
    ['✍️', 'Améliorer l’écriture', 'Améliore l’écriture du texte ciblé : plus clair, plus fluide, même sens et même langue.'],
    ['✅', 'Corriger l’orthographe et la grammaire', 'Corrige l’orthographe, la grammaire et la ponctuation du texte ciblé sans changer le style.'],
    ['✂️', 'Raccourcir', 'Rends le texte ciblé plus concis en gardant l’essentiel.'],
    ['➕', 'Développer', 'Développe le texte ciblé avec plus de détails et d’exemples.'],
    ['👔', 'Ton professionnel', 'Réécris le texte ciblé avec un ton professionnel.'],
    ['😎', 'Ton décontracté', 'Réécris le texte ciblé avec un ton décontracté et amical.'],
    ['🇬🇧', 'Traduire en anglais', 'Traduis le texte ciblé en anglais.'],
    ['🇫🇷', 'Traduire en français', 'Traduis le texte ciblé en français.'],
    ['💡', 'Expliquer', 'Explique simplement le texte ciblé.'],
  ];
  const TABLE_ACTIONS = [
    ['🪄', 'Remplir les cellules vides', 'Remplis toutes les cellules vides du tableau avec des valeurs pertinentes et cohérentes avec le reste, dans la même langue que le tableau. Garde les cellules déjà remplies telles quelles.'],
    ['➕', 'Ajouter des lignes', 'Ajoute 5 nouvelles lignes pertinentes à la fin du tableau, dans la continuité des lignes existantes.'],
    ['🧱', 'Ajouter une colonne utile', 'Ajoute une colonne pertinente au tableau et remplis-la pour chaque ligne.'],
    ['✅', 'Corriger le tableau', 'Corrige l’orthographe, la grammaire et les incohérences dans le tableau.'],
    ['🇬🇧', 'Traduire en anglais', 'Traduis tout le contenu du tableau en anglais.'],
    ['🇫🇷', 'Traduire en français', 'Traduis tout le contenu du tableau en français.'],
    ['📝', 'Résumer le tableau', 'Résume en quelques points ce que montre le tableau (ne renvoie pas le tableau).'],
  ];
  const PAGE_ACTIONS = [
    ['🖊', 'Continuer à écrire', 'Continue la page de façon naturelle à partir de là où elle s’arrête (quelques paragraphes).'],
    ['📝', 'Résumer la page', 'Résume la page en quelques points clés.'],
    ['☑', 'Extraire les tâches', 'Extrais toutes les actions à faire de la page sous forme de cases à cocher (- [ ]).'],
    ['🧠', 'Trouver des idées', 'Propose une liste d’idées originales en lien avec le sujet de la page.'],
    ['🗂', 'Rédiger un plan', 'Propose un plan structuré (titres et sous-points) pour le sujet de la page.'],
    ['▦', 'Créer un tableau', 'Crée un tableau Markdown utile et bien rempli en lien avec le sujet de la page (par exemple une comparaison, un planning ou un récapitulatif).'],
  ];

  function pageMarkdown(p) {
    let md = toMarkdown(p);
    if (md.length > 24000) md = md.slice(0, 12000) + '\n…\n' + md.slice(-12000);
    return md;
  }

  // Cible : sélection dans un bloc, sinon le bloc courant (s'il a du texte), sinon la page.
  function captureTarget(blockId) {
    const p = S.pages[current];
    if (!p) return null;
    const t = { page: p, blockId: blockId || null, text: '', sel: null };
    const b = blockId && p.blocks.find((x) => x.id === blockId);
    if (!b) return t;
    if (b.type === 'table') { t.text = Table.toMd(b); t.table = true; return t; }
    const c = document.querySelector(`.block[data-id="${blockId}"] .content[contenteditable]`);
    const s = getSelection();
    if (c && s.rangeCount && !s.isCollapsed && c.contains(s.anchorNode) && c.contains(s.focusNode)) {
      const r = s.getRangeAt(0);
      const pre = r.cloneRange();
      pre.selectNodeContents(c);
      pre.setEnd(r.startContainer, r.startOffset);
      const start = pre.toString().length;
      t.sel = { start, end: start + r.toString().length };
      t.text = r.toString();
    } else {
      t.text = b.type === 'code' ? b.text : plain(String(b.text).replace(/<br>/g, '\n'));
    }
    return t;
  }

  function open(blockId) {
    if (!CLOUD) { toast('L’IA est disponible dans la version en ligne de ReNotion'); return; }
    const target = captureTarget(blockId);
    if (!target) return;
    closePop();

    const input = h('input', { type: 'text', placeholder: target.table ? 'Que faire avec ce tableau ? (ex. « ajoute une colonne prix »)' : target.text.trim() ? 'Que faire avec ce texte ?' : 'Demander à l’IA d’écrire, résumer, brainstormer…', 'aria-label': 'Demande à l’IA' });
    const send = h('button', { class: 'icon-btn ai-send', title: 'Envoyer' }, '↑');
    const out = h('div', { class: 'ai-out', hidden: true });
    const list = h('div', { class: 'ai-list' });
    const foot = h('div', { class: 'ai-foot', hidden: true });
    const panel = h('div', { class: 'pop ai-panel', id: 'ai' }, h('div', { class: 'ai-input' }, h('span', { class: 'ai-spark' }, '✨'), input, send), out, foot, list);

    const actions = target.table ? TABLE_ACTIONS : target.text.trim() ? TEXT_ACTIONS : PAGE_ACTIONS;
    const drawList = () => {
      list.innerHTML = '';
      list.append(h('div', { class: 'hdr' }, target.table ? 'Modifier ce tableau' : target.text.trim() ? (target.sel ? 'Modifier la sélection' : 'Modifier ce bloc') : 'Écrire avec l’IA'));
      actions.forEach(([ic, label, instr]) => list.append(h('button', { class: 'item', onclick: () => run(instr, label) }, h('span', { class: 'ic' }, ic), label)));
      if (target.text.trim()) {
        list.append(h('div', { class: 'hdr' }, 'Page'));
        PAGE_ACTIONS.slice(1, 3).forEach(([ic, label, instr]) => list.append(h('button', { class: 'item', onclick: () => { target.text = ''; target.sel = null; run(instr, label); } }, h('span', { class: 'ic' }, ic), label)));
      }
    };
    drawList();

    let answer = '';
    let lastInstr = '';
    const ask = () => { const v = input.value.trim(); if (v) run(v, v); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); ask(); }
      else if (e.key === 'Escape') { stop(); closePop(); }
    });
    send.addEventListener('click', ask);

    async function run(instruction, label) {
      lastInstr = instruction;
      list.hidden = true;
      out.hidden = false;
      foot.hidden = false;
      out.textContent = '';
      out.classList.add('loading');
      answer = '';
      input.value = '';
      input.placeholder = label;
      foot.innerHTML = '';
      foot.append(h('span', { class: 'muted' }, 'L’IA écrit…'), h('button', { class: 'btn', onclick: stop }, 'Arrêter'));

      const user = [
        `Titre de la page : ${titleOf(target.page)}`,
        `Contenu de la page (Markdown) :\n<<<\n${pageMarkdown(target.page)}\n>>>`,
        target.text.trim() ? `${target.table ? 'Tableau ciblé (Markdown)' : 'Texte ciblé'} :\n<<<\n${target.text}\n>>>` : '',
        `Instruction : ${instruction}`,
      ].filter(Boolean).join('\n\n');

      ctrl = new AbortController();
      try {
        const tok = await Cloud.token();
        const res = await fetch(Cloud.fnUrl('ai'), {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}`, apikey: Cloud.config.supabaseKey },
          body: JSON.stringify({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || `Erreur ${res.status}`);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            const m = line.match(/^data:\s*(.*)$/);
            if (!m || m[1] === '[DONE]') continue;
            try {
              const d = JSON.parse(m[1]);
              const piece = d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content;
              if (piece) { answer += piece; out.textContent = clean(answer); out.scrollTop = out.scrollHeight; }
            } catch (e) { /* fragment incomplet */ }
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          out.classList.remove('loading');
          out.textContent = '⚠️ ' + err.message;
          foot.innerHTML = '';
          foot.append(h('button', { class: 'btn', onclick: () => run(lastInstr, label) }, 'Réessayer'), h('button', { class: 'btn', onclick: () => closePop() }, 'Fermer'));
          return;
        }
      } finally { ctrl = null; }
      out.classList.remove('loading');
      answer = clean(answer);
      finish(label);
    }

    function finish(label) {
      foot.innerHTML = '';
      if (!answer.trim()) { out.textContent = 'Aucune réponse.'; }
      const canReplace = !!target.blockId && !!target.text.trim() && (!target.table || /^\s*\|.*\|\s*$/m.test(answer));
      foot.append(
        canReplace ? h('button', { class: 'btn primary', onclick: () => apply('replace') }, target.sel ? 'Remplacer la sélection' : target.table ? 'Mettre à jour le tableau' : 'Remplacer') : null,
        h('button', { class: 'btn' + (canReplace ? '' : ' primary'), onclick: () => apply('below') }, 'Insérer en dessous'),
        h('button', { class: 'btn', onclick: () => run(lastInstr, label) }, 'Réessayer'),
        h('button', { class: 'btn', onclick: () => navigator.clipboard.writeText(answer).then(() => toast('Copié')) }, 'Copier'),
        h('button', { class: 'btn', onclick: () => closePop() }, 'Annuler'));
      input.placeholder = 'Demander une modification…';
      input.focus();
    }

    function apply(how) {
      const p = target.page;
      if (!answer.trim() || !S.pages[p.id]) return closePop();
      const blocks = mdToBlocks(answer);
      if (!blocks.length) return closePop();
      const i = target.blockId ? p.blocks.findIndex((b) => b.id === target.blockId) : -1;
      const ref = p.blocks[i];
      let focusId = blocks[blocks.length - 1].id;
      const ti = blocks.findIndex((x) => x.type === 'table');
      if (how === 'replace' && ref && ref.type === 'table' && ti >= 0) {
        // on garde le même bloc (et son identifiant) pour une synchro propre
        const nt = blocks.splice(ti, 1)[0];
        Object.assign(ref, { rows: nt.rows, headerRow: nt.headerRow || ref.headerRow });
        p.blocks.splice(i + 1, 0, ...blocks);
        focusId = ref.id;
      } else if (how === 'replace' && ref && target.sel && blocks.length === 1 && ref.type !== 'code') {
        const c = document.querySelector(`.block[data-id="${ref.id}"] .content`);
        if (c) {
          const r = rangeOf(c, target.sel.start, target.sel.end);
          r.deleteContents();
          r.insertNode(r.createContextualFragment(blocks[0].text));
          ref.text = c.innerHTML;
        }
      } else if (how === 'replace' && ref) {
        blocks.forEach((b) => { b.indent = (b.indent || 0) + (ref.indent || 0); });
        if (blocks.length === 1 && blocks[0].type === 'p' && ref.type !== 'code') { ref.text = blocks[0].text; }
        else p.blocks.splice(i, 1, ...blocks);
      } else {
        let at = i >= 0 ? i + 1 : p.blocks.length;
        const last = p.blocks[p.blocks.length - 1];
        if (i < 0 && last && last.type === 'p' && !plain(last.text).trim()) at = p.blocks.length - 1;
        p.blocks.splice(at, 0, ...blocks);
      }
      touch(p);
      closePop();
      if (p.id === current) { renderBlocks(); focusBlock(focusId, 'end'); }
      toast('Contenu de l’IA ajouté');
    }

    // Position : sous le bloc ciblé, sinon en bas de l'écran
    $('#layer').append(panel);
    const row = target.blockId && document.querySelector(`.block[data-id="${target.blockId}"]`);
    const r = row ? row.getBoundingClientRect() : null;
    const w = Math.min(560, innerWidth - 16);
    panel.style.width = w + 'px';
    const left = r ? Math.min(Math.max(8, r.left), innerWidth - w - 8) : (innerWidth - w) / 2;
    panel.style.left = left + 'px';
    if (r && r.bottom + 360 < innerHeight) panel.style.top = r.bottom + 6 + 'px';
    else panel.style.bottom = '16px';
    input.focus();
  }

  function clean(t) {
    return t.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');
  }

  function stop() { if (ctrl) ctrl.abort(); }

  return { open, stop };
})();
