'use strict';

/* Radio : bouton en haut à droite, stations du monde entier, lecture continue pendant la navigation. */

const Radio = (() => {
  const STATIONS = [
    { name: 'FIP', desc: 'La plus éclectique (Paris)', url: 'https://icecast.radiofrance.fr/fip-midfi.mp3', code: 'fr' },
    { name: 'Radio Meuh', desc: 'Le son du Reblochon', url: 'https://radiomeuh.ice.infomaniak.ch/radiomeuh-128.mp3', code: 'fr' },
    { name: 'SomaFM Groove Salad', desc: 'Ambient / chill', url: 'https://ice1.somafm.com/groovesalad-128-mp3', code: 'us' },
    { name: 'bigFM Hamburg', desc: 'Charts & nouveautés', url: 'https://stream.bigfm.de/hamburg/mp3-128', code: 'de' },
    { name: 'SomaFM Fluid', desc: 'Hip-hop instrumental', url: 'https://ice1.somafm.com/fluid-128-mp3', code: 'us' },
    { name: 'NPO FunX Utrecht', desc: 'Urban & hits (Pays-Bas)', url: 'https://icecast.omroep.nl/funx-utrecht-bb-mp3', code: 'nl' },
    { name: 'Radio SAW Urban', desc: 'Urban (Allemagne)', url: 'https://stream.radiosaw.de/saw-urban/mp3-128', code: 'de' },
    { name: 'UCB Ireland', desc: 'Musique chrétienne & talk', url: 'https://stream.btsstream.com:8022/ucbireland.mp3', code: 'ie' },
    { name: 'KEXP Seattle', desc: 'Where the music matters', url: 'https://kexp-mp3-128.streamguys1.com/kexp128.mp3', code: 'us' },
    { name: 'Rhubarb Radio', desc: 'Pop & local (Wakefield)', url: 'https://securestreams2.autopo.st:1234/stream', code: 'gb' },
    { name: 'Lofi Girl', desc: 'Beats to study / relax to', url: 'https://lofi.stream.laut.fm/lofi', code: '🎧' },
    { name: 'NTS Radio 1', desc: 'Underground (Londres)', url: 'https://stream-relay-geo.ntslive.net/stream', code: 'gb' },
    { name: 'laut.fm Jazz', desc: 'Jazz en continu', url: 'https://stream.laut.fm/jazz', code: '🎷' },
  ];
  const KEY = 'renotion:radio';
  const audio = new Audio();
  audio.preload = 'none';
  let index = -1;
  let state = 'off'; // off | loading | playing | paused | error
  let panel = null;

  // Code pays (« fr ») → drapeau emoji ; sinon on garde le symbole tel quel
  const flag = (code) => (/^[a-z]{2}$/i.test(code) ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : code);

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ index, volume: audio.volume, playing: state === 'playing' || state === 'loading', at: Date.now() })); } catch (e) { /* ignore */ }
  }

  function setState(s) {
    state = s;
    const btn = $('#btn-radio');
    if (btn) {
      btn.textContent = s === 'playing' ? '🎶' : '📻';
      btn.classList.toggle('on', s === 'playing' || s === 'loading');
      btn.title = index >= 0 && (s === 'playing' || s === 'loading') ? `Radio : ${STATIONS[index].name}` : 'Radio';
    }
    if (panel) draw();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s === 'playing' ? 'playing' : s === 'paused' ? 'paused' : 'none';
  }

  function mediaSession() {
    if (!('mediaSession' in navigator) || index < 0) return;
    const s = STATIONS[index];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: s.name, artist: s.desc, album: 'ReNotion · Radio' });
      navigator.mediaSession.setActionHandler('play', () => play());
      navigator.mediaSession.setActionHandler('pause', () => pause());
      navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
      navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
    } catch (e) { /* navigateur ancien */ }
  }

  function play(resume = false) {
    if (index < 0) index = 0;
    const url = STATIONS[index].url;
    if (audio.src !== url) audio.src = url;
    setState('loading');
    mediaSession();
    audio.play().then(() => { setState('playing'); save(); }).catch((e) => {
      if (e && e.name === 'NotAllowedError') {
        // lecture automatique bloquée : on reprend au premier clic ou à la première touche
        setState('paused');
        if (resume) {
          const go = () => { ['pointerdown', 'keydown'].forEach((ev) => document.removeEventListener(ev, go, true)); play(); };
          ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, go, true));
        }
      } else if (e && e.name !== 'AbortError') setState('error');
    });
  }

  function pause() {
    audio.pause();
    setState('paused');
    save();
  }

  function select(i) {
    if (i === index && (state === 'playing' || state === 'loading')) { pause(); return; }
    index = i;
    audio.src = STATIONS[i].url;
    play();
  }

  function step(dir) { select((Math.max(index, 0) + dir + STATIONS.length) % STATIONS.length); }

  function toggle() { if (state === 'playing' || state === 'loading') pause(); else play(); }

  audio.addEventListener('playing', () => setState('playing'));
  audio.addEventListener('waiting', () => { if (state === 'playing') setState('loading'); });
  audio.addEventListener('error', () => { if (audio.src && state !== 'paused' && state !== 'off') setState('error'); });

  /* ---------- Panneau ---------- */

  const STATUS = { off: 'Éteinte', loading: 'Connexion…', playing: '● En direct', paused: 'En pause', error: 'Station indisponible' };

  function draw() {
    panel.innerHTML = '';
    const list = h('div', { class: 'radio-list' }, STATIONS.map((s, i) => h('button', {
      class: 'radio-item' + (i === index ? ' active' : '') + (i === index && state === 'playing' ? ' live' : ''),
      onclick: () => select(i),
    },
      h('span', { class: 'radio-flag' }, flag(s.code)),
      h('span', { class: 'radio-info' }, h('span', { class: 'radio-name' }, s.name), h('span', { class: 'radio-desc' }, s.desc)),
      i === index && state === 'playing' ? h('span', { class: 'radio-eq' }, h('i'), h('i'), h('i')) : null)));
    const vol = h('input', { type: 'range', class: 'radio-vol', min: 0, max: 1, step: 0.01, value: audio.volume, 'aria-label': 'Volume' });
    vol.addEventListener('input', () => { audio.volume = +vol.value; save(); });
    panel.append(
      h('div', { class: 'radio-head' }, h('b', {}, '🌍 Radio'), h('span', { class: 'radio-status ' + state }, STATUS[state])),
      list,
      h('div', { class: 'radio-ctrl' },
        h('button', { class: 'icon-btn', title: 'Station précédente', onclick: () => step(-1) }, '⏮'),
        h('button', { class: 'radio-play', title: state === 'playing' ? 'Pause' : 'Lecture', onclick: toggle }, state === 'playing' || state === 'loading' ? '⏸' : '▶'),
        h('button', { class: 'icon-btn', title: 'Station suivante', onclick: () => step(1) }, '⏭'),
        h('span', { class: 'radio-vol-ico' }, audio.volume === 0 ? '🔇' : '🔊'),
        vol));
    const active = list.querySelector('.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function open(anchor) {
    if (panel && panel.isConnected) { panel.remove(); panel = null; return; }
    document.querySelectorAll('.pop').forEach((p) => p.remove());
    panel = h('div', { class: 'pop radio-panel', id: 'radio' });
    $('#layer').append(panel);
    draw();
    const r = anchor.getBoundingClientRect();
    const w = Math.min(320, innerWidth - 16);
    panel.style.width = w + 'px';
    panel.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
    panel.style.top = r.bottom + 6 + 'px';
  }

  /* ---------- Démarrage ---------- */

  function init() {
    const btn = $('#btn-radio');
    if (!btn) return;
    btn.addEventListener('click', (e) => { e.stopPropagation(); open(btn); });
    audio.volume = 0.5;
    try {
      const st = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (st && st.index >= 0 && st.index < STATIONS.length) {
        index = st.index;
        audio.volume = typeof st.volume === 'number' ? st.volume : 0.5;
        // reprend la lecture si elle tournait il y a moins de 2 h
        if (st.playing && Date.now() - st.at < 2 * 3600 * 1000) play(true);
        else setState('paused');
      }
    } catch (e) { /* ignore */ }
    window.addEventListener('pagehide', save);
  }

  return { init, select, toggle, get playing() { return state === 'playing'; } };
})();
