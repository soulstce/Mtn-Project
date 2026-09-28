// Small rendering helpers shared by every view.

import { prefs } from './prefs.js';

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const TYPES = ['Sport', 'Trad', 'TR', 'Boulder', 'Ice', 'Aid', 'Mixed', 'Alpine', 'Snow'];
export const TYPE_COLORS = {
  Sport: 'var(--t-sport)', Trad: 'var(--t-trad)', TR: 'var(--t-tr)', Toprope: 'var(--t-tr)',
  Boulder: 'var(--t-boulder)', Ice: 'var(--t-ice)', Aid: 'var(--t-aid)',
  Mixed: 'var(--t-mixed)', Alpine: 'var(--t-alpine)', Snow: 'var(--t-snow)',
};

export const icons = {
  search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6m0-6-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13"/></svg>',
  area: '<svg viewBox="0 0 24 24"><path d="M3 20 9.5 8l4 7 2.5-4L21 20z"/></svg>',
  route: '<svg viewBox="0 0 24 24"><path d="M7 21c0-5 10-5 10-10S12 5 12 3"/><circle cx="12" cy="3" r="1"/></svg>',
};

// ---------------------------------------------------------------- grades

/** Colour band 1..7 for a grade sort key. */
export function gradeBand(key) {
  if (key == null) return 0;
  if (key < 20000) { // rock, YDS
    const n = (key - 1000) / 100;
    if (n < 8) return 1;
    if (n < 10) return 2;
    if (n < 11) return 3;
    if (n < 12) return 4;
    if (n < 13) return 5;
    if (n < 14) return 6;
    return 7;
  }
  if (key < 30000) { // boulder, V
    const v = (key - 20000) / 100;
    if (v < 3) return 1;
    if (v < 5) return 2;
    if (v < 7) return 3;
    if (v < 9) return 4;
    if (v < 11) return 5;
    if (v < 13) return 6;
    return 7;
  }
  if (key < 50000) return Math.min(7, Math.max(1, Math.round((key - 30000) / 100)));
  return 4;
}

const ROCK_SYSTEMS = { yds: 'YDS', french: 'French', uiaa: 'UIAA', ewbanks: 'Ewbanks', british: 'British', za: 'ZA' };
const BOULDER_SYSTEMS = { yds: 'V-scale', font: 'Font' };
export { ROCK_SYSTEMS, BOULDER_SYSTEMS };

/** The grade to display for a route, honouring the user's grade system. */
export function displayGrade(route) {
  const grades = route.grades || {};
  const isBoulder = route.grade_key >= 20000 && route.grade_key < 30000;
  const pref = isBoulder ? prefs.get('boulderSystem') : prefs.get('rockSystem');
  if (pref !== 'yds' && grades[pref]) return grades[pref];
  return route.grade || grades.yds || '?';
}

export function gradeBadge(route, big = false) {
  const band = gradeBand(route.grade_key);
  return `<span class="grade g${band}${big ? ' big' : ''}">${esc(displayGrade(route))}</span>`;
}

/** Histogram bucket for a grade key: {id, label, order}. */
export function gradeBucket(key) {
  if (key == null) return { id: 'none', label: '?', order: 99999 };
  if (key < 20000) {
    const n = Math.floor((key - 1000) / 100);
    if (n <= 6) return { id: 'r6', label: '≤5.6', order: 1006 };
    if (n >= 14) return { id: 'r14', label: '5.14+', order: 1014 };
    return { id: `r${n}`, label: `5.${n}`, order: 1000 + n };
  }
  if (key < 30000) {
    const v = Math.floor((key - 20000) / 100);
    if (v <= 0) return { id: 'v0', label: 'V0', order: 2000 };
    if (v >= 12) return { id: 'v12', label: 'V12+', order: 2012 };
    return { id: `v${v}`, label: `V${v}`, order: 2000 + v };
  }
  if (key < 50000) {
    const w = Math.floor((key - 30000) / 100);
    return { id: `i${w}`, label: `WI${w}`, order: 3000 + w };
  }
  if (key < 70000) return { id: 'mixed', label: 'M', order: 5000 };
  if (key < 80000) return { id: 'aid', label: 'Aid', order: 7000 };
  return { id: 'snow', label: 'Snow', order: 8000 };
}

// --------------------------------------------------------------- pieces

export function stars(value, votes) {
  if (value == null) return '';
  const full = Math.round(value * 2) / 2;
  let out = '';
  for (let i = 1; i <= 4; i++) {
    if (full >= i) out += '★';
    else if (full >= i - 0.5) out += '<span class="half">★</span>';
    else out += '<span class="off">★</span>';
  }
  const title = `${value.toFixed(1)} stars${votes ? ` from ${votes} votes` : ''}`;
  return `<span class="stars" title="${title}" aria-label="${title}">${out}</span>`;
}

export function typeTags(types = []) {
  return types.map((t) => `<span class="type type-${esc(t)}">${esc(t)}</span>`).join(' ');
}

export function typeBar(counts) {
  const entries = Object.entries(counts || {}).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (!total) return '';
  return `<div class="typebar" title="${entries.map(([t, n]) => `${t}: ${n}`).join(', ')}">${
    entries.map(([t, n]) => `<i style="width:${(n / total) * 100}%;background:${TYPE_COLORS[t] || 'var(--muted)'}"></i>`).join('')
  }</div>`;
}

export function crumbs(list = [], { local = new Set(), light = false } = {}) {
  if (!list.length) return '';
  return `<nav class="crumbs" aria-label="Breadcrumb">${list.map((c, i) => {
    const href = local.has(c.id) ? `#/area/${c.id}` : `#/discover/area/${c.id}`;
    return `${i ? '<span class="sep">›</span>' : ''}<a href="${href}">${esc(c.name)}</a>`;
  }).join('')}</nav>`;
}

export const spinner = () => '<div class="spinner" role="progressbar" aria-label="Loading"></div>';

export function empty(title, text, action = '') {
  return `<div class="empty"><h2>${esc(title)}</h2><p>${text}</p>${action}</div>`;
}

export function plural(n, word, pluralWord = `${word}s`) {
  return `${(n ?? 0).toLocaleString()} ${n === 1 ? word : pluralWord}`;
}

export function mapsUrl(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export function mpUrl(kind, id) {
  return `https://www.mountainproject.com/${kind}/${id}`;
}

export function timeAgo(ts) {
  if (!ts) return '';
  const s = Date.now() / 1000 - ts;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 45) return `${Math.round(s / 86400)} days ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

let toastTimer;
export function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// -------------------------------------------------------------- lightbox

export function openLightbox(photos, index = 0) {
  const box = $('#lightbox');
  let i = index;
  const render = () => {
    const p = photos[i];
    box.innerHTML = `
      <button class="close" aria-label="Close">✕</button>
      ${photos.length > 1 ? '<button class="prev" aria-label="Previous">‹</button><button class="next" aria-label="Next">›</button>' : ''}
      <img src="${esc(p.full || p.thumb)}" alt="${esc(p.title)}">
      <div class="cap">${esc(p.title || '')}${photos.length > 1 ? ` <span class="muted">· ${i + 1}/${photos.length}</span>` : ''}</div>`;
  };
  const close = () => {
    box.hidden = true;
    box.innerHTML = '';
    document.removeEventListener('keydown', onKey);
  };
  const step = (d) => { i = (i + d + photos.length) % photos.length; render(); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  };
  box.onclick = (e) => {
    if (e.target.closest('.prev')) step(-1);
    else if (e.target.closest('.next')) step(1);
    else if (e.target.closest('.close') || e.target === box) close();
  };
  let startX = null;
  box.ontouchstart = (e) => { startX = e.touches[0].clientX; };
  box.ontouchend = (e) => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    startX = null;
  };
  document.addEventListener('keydown', onKey);
  render();
  box.hidden = false;
}

export function photoGrid(photos) {
  if (!photos?.length) return '';
  return `<div class="photo-grid">${photos.map((p, i) =>
    `<button data-photo="${i}" aria-label="${esc(p.title || 'Photo')}"><img loading="lazy" src="${esc(p.thumb)}" alt="${esc(p.title)}"></button>`
  ).join('')}</div>`;
}

export function photoStrip(photos) {
  if (!photos?.length) return '';
  return `<div class="photo-strip">${photos.map((p, i) =>
    `<button data-photo="${i}" aria-label="${esc(p.title || 'Photo')}"><img loading="${i < 2 ? 'eager' : 'lazy'}" src="${esc(p.full || p.thumb)}" alt="${esc(p.title)}"></button>`
  ).join('')}</div>`;
}

/** Wire up [data-photo] buttons inside root to the lightbox. */
export function bindPhotos(root, photos) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-photo]');
    if (btn && root.contains(btn)) openLightbox(photos, Number(btn.dataset.photo));
  });
}
