// Filterable, sortable route list with a clickable grade histogram.
// Used by area pages and search. Filtering is fully client side, so it works
// offline on whatever routes.json the area has cached.

import { prefs } from '../prefs.js';
import {
  esc, stars, typeTags, gradeBadge, gradeBucket, gradeBand, displayGrade, TYPES, TYPE_COLORS, plural,
} from '../ui.js';

const PAGE = 300;

const SORTS = {
  wall: { label: 'Wall order', fn: null },
  gradeAsc: { label: 'Grade ↑', fn: (a, b) => (a.grade_key ?? 1e9) - (b.grade_key ?? 1e9) },
  gradeDesc: { label: 'Grade ↓', fn: (a, b) => (b.grade_key ?? -1) - (a.grade_key ?? -1) },
  stars: { label: 'Most stars', fn: (a, b) => (b.stars ?? -1) - (a.stars ?? -1) || (b.votes ?? 0) - (a.votes ?? 0) },
  name: { label: 'Name', fn: (a, b) => a.name.localeCompare(b.name) },
};

const SHOW = {
  all: 'All routes',
  todo: 'My to-dos',
  ticked: 'Ticked',
  unticked: 'Not ticked',
};

function matchesText(route, q) {
  if (!q) return true;
  const hay = `${route.name} ${route.area_name || ''} ${displayGrade(route)} ${route.grade || ''}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/**
 * Mount a route explorer.
 * @param {HTMLElement} el
 * @param {Array} routes  route summaries
 * @param {{grouped?: boolean, initial?: object, onState?: Function}} opts
 */
export function mountRouteExplorer(container, routes, opts = {}) {
  const el = document.createElement('div');
  container.replaceChildren(el);
  const state = {
    q: '',
    types: new Set(),
    buckets: new Set(),
    minStars: 0,
    sort: prefs.get('listSort') || 'wall',
    show: 'all',
    limit: PAGE,
    ...opts.initial,
  };
  if (!opts.grouped && state.sort === 'wall' && !opts.hasWallOrder) state.sort = 'stars';

  const presentTypes = TYPES.filter((t) => routes.some((r) => r.types?.includes(t)));

  el.innerHTML = `
    <div class="filters">
      <div class="filter-row">
        <div class="search-box grow">
          <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>
          <input class="input" type="search" data-f="q" placeholder="Filter ${plural(routes.length, 'route')}…" value="${esc(state.q)}">
        </div>
        <select class="input" data-f="sort" aria-label="Sort">
          ${Object.entries(SORTS).map(([k, s]) => `<option value="${k}"${k === state.sort ? ' selected' : ''}>${s.label}</option>`).join('')}
        </select>
        <select class="input" data-f="minStars" aria-label="Minimum stars">
          ${[0, 1, 2, 3].map((n) => `<option value="${n}"${n === state.minStars ? ' selected' : ''}>${n ? `${'★'.repeat(n)}+` : 'Any stars'}</option>`).join('')}
        </select>
        <select class="input" data-f="show" aria-label="Show">
          ${Object.entries(SHOW).map(([k, s]) => `<option value="${k}"${k === state.show ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      ${presentTypes.length > 1 ? `<div class="chips" data-types>
        ${presentTypes.map((t) => `<button class="chip" data-type="${t}"><span class="dot" style="background:${TYPE_COLORS[t]}"></span>${t}</button>`).join('')}
      </div>` : ''}
      <div class="card pad" data-histo-wrap>
        <div class="section-head" style="margin:0">
          <h3>Grades</h3>
          <button class="chip" data-clear-grades hidden>Clear grade filter</button>
        </div>
        <div class="histo" data-histo></div>
      </div>
    </div>
    <div class="muted small" data-count></div>
    <div class="route-list" data-list></div>
  `;

  const $ = (s) => el.querySelector(s);

  const filtered = (ignoreGrades = false) => routes.filter((r) => {
    if (state.types.size && !r.types?.some((t) => state.types.has(t))) return false;
    if (state.minStars && (r.stars ?? 0) < state.minStars) return false;
    if (!matchesText(r, state.q)) return false;
    if (state.show === 'todo' && !prefs.todo(r.id)) return false;
    if (state.show === 'ticked' && !prefs.tick(r.id)) return false;
    if (state.show === 'unticked' && prefs.tick(r.id)) return false;
    if (!ignoreGrades && state.buckets.size && !state.buckets.has(gradeBucket(r.grade_key).id)) return false;
    return true;
  });

  function drawHisto() {
    const counts = new Map();
    for (const r of filtered(true)) {
      const b = gradeBucket(r.grade_key);
      if (b.id === 'none') continue;
      const entry = counts.get(b.id) || { ...b, n: 0, band: gradeBand(r.grade_key) };
      entry.n++;
      counts.set(b.id, entry);
    }
    const buckets = [...counts.values()].sort((a, b) => a.order - b.order);
    const max = Math.max(1, ...buckets.map((b) => b.n));
    const histo = $('[data-histo]');
    $('[data-histo-wrap]').hidden = buckets.length < 2 && !state.buckets.size;
    histo.classList.toggle('filtering', state.buckets.size > 0);
    histo.innerHTML = buckets.map((b) => `
      <button data-bucket="${b.id}" class="${state.buckets.has(b.id) ? 'on' : ''}" title="${b.label}: ${b.n}">
        <span class="n">${b.n}</span>
        <span class="bar" style="height:${Math.max(3, (b.n / max) * 70)}px;background:var(--g${b.band})"></span>
        <span class="lbl">${b.label}</span>
      </button>`).join('');
    $('[data-clear-grades]').hidden = !state.buckets.size;
  }

  function row(r, index, last, showArea) {
    const tick = prefs.tick(r.id);
    const todo = prefs.todo(r.id);
    const bits = [
      r.stars != null ? stars(r.stars, r.votes) : '',
      typeTags(r.types),
      r.pitches > 1 ? `${r.pitches} pitches` : '',
      r.length_ft ? `${r.length_ft} ft` : '',
      showArea && r.area_name ? `<span>${esc(r.area_name)}</span>` : '',
    ].filter(Boolean);
    return `
      <a class="route-row${last ? ' last' : ''}" href="#/route/${r.id}">
        <span class="idx">${index}</span>
        <div style="min-width:0">
          <div class="name"><span class="t">${esc(r.name)}</span>
            ${tick ? '<span class="mark tick" title="Ticked">✓</span>' : ''}
            ${todo ? '<span class="mark todo" title="To-do">★</span>' : ''}
          </div>
          <div class="info">${bits.join('')}</div>
        </div>
        <div class="right">
          ${r.thumb ? `<img class="thumb" loading="lazy" src="${esc(r.thumb)}" alt="">` : ''}
          ${gradeBadge(r)}
        </div>
      </a>`;
  }

  function drawList() {
    let list = filtered();
    const sorter = SORTS[state.sort]?.fn;
    if (sorter) list = [...list].sort(sorter);
    const shown = list.slice(0, state.limit);
    $('[data-count]').textContent = list.length === routes.length
      ? plural(routes.length, 'route')
      : `${list.length.toLocaleString()} of ${plural(routes.length, 'route')}`;

    let out = '';
    if (!list.length) {
      out = '<div class="empty"><p>No routes match these filters.</p></div>';
    } else if (state.sort === 'wall' && opts.grouped) {
      let current = null;
      shown.forEach((r, i) => {
        if (r.area_id !== current) {
          current = r.area_id;
          const n = list.filter((x) => x.area_id === current).length;
          out += `<div class="group-title"><a href="#/area/${r.area_id}">${esc(r.area_name || 'Routes')}</a><span>${n}</span></div>`;
        }
        const last = shown[i + 1]?.area_id !== current;
        out += row(r, (r.order ?? i) + 1, last, false);
      });
    } else {
      shown.forEach((r, i) => { out += row(r, i + 1, i === shown.length - 1, true); });
    }
    if (list.length > shown.length) {
      out += `<div style="text-align:center;margin:16px"><button class="btn" data-more>Show ${Math.min(PAGE, list.length - shown.length)} more</button></div>`;
    }
    $('[data-list]').innerHTML = out;
  }

  function redraw() {
    drawHisto();
    drawList();
    el.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('on', state.types.has(b.dataset.type)));
    opts.onState?.(state);
  }

  el.addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    if (f === 'q') {
      state.q = e.target.value.trim().toLowerCase();
      state.limit = PAGE;
      redraw();
    }
  });
  el.addEventListener('change', (e) => {
    const f = e.target.dataset.f;
    if (!f || f === 'q') return;
    state[f] = f === 'minStars' ? Number(e.target.value) : e.target.value;
    if (f === 'sort') prefs.set('listSort', state.sort);
    state.limit = PAGE;
    redraw();
  });
  el.addEventListener('click', (e) => {
    const typeBtn = e.target.closest('[data-type]');
    const bucketBtn = e.target.closest('[data-bucket]');
    if (typeBtn) {
      const t = typeBtn.dataset.type;
      state.types.has(t) ? state.types.delete(t) : state.types.add(t);
    } else if (bucketBtn) {
      const b = bucketBtn.dataset.bucket;
      state.buckets.has(b) ? state.buckets.delete(b) : state.buckets.add(b);
    } else if (e.target.closest('[data-clear-grades]')) {
      state.buckets.clear();
    } else if (e.target.closest('[data-more]')) {
      state.limit += PAGE;
      drawList();
      return;
    } else {
      return;
    }
    state.limit = PAGE;
    redraw();
  });

  redraw();
  return state;
}
