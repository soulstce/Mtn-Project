import { api } from '../api.js';
import { esc, icons, spinner, plural } from '../ui.js';
import { mountRouteExplorer } from './routelist.js';

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function remoteResults(results) {
  if (!results.length) return '<p class="muted small">No matches on Mountain Project.</p>';
  return `<div class="list">${results.map((r) => `
    <div class="card list-item">
      <span class="icon">${r.kind === 'area' ? icons.area : icons.route}</span>
      <span class="grow"><b>${esc(r.name)}</b><small>${r.grade ? `${esc(r.grade)} · ` : ''}${esc(r.location)}</small></span>
      ${r.kind === 'area'
        ? `<a class="btn" href="#/discover/area/${r.id}">Open</a>`
        : `<a class="btn" href="#/route/${r.id}">View</a>
           <button class="btn primary" data-dl-route="${r.id}" title="Download the crag this route is on">${icons.download}</button>`}
    </div>`).join('')}</div>`;
}

export async function renderSearch(el, params) {
  el.innerHTML = spinner();
  const index = await api.index();
  let q = params.get('q') || '';

  el.innerHTML = `
    <header class="page-head"><div><h1>Search</h1>
      <p class="muted">${plural(index.routes.length, 'route')} in ${plural(index.areas.length, 'area')} on hand</p></div></header>
    <div class="search-box">${icons.search}
      <input class="input" id="q" type="search" placeholder="Route, crag, or grade (e.g. 5.10, V4)…" value="${esc(q)}" autofocus autocomplete="off">
    </div>
    <section class="section" data-areas></section>
    <section class="section" data-routes></section>
    <section class="section server-only" data-remote></section>
  `;
  const input = el.querySelector('#q');
  const areasEl = el.querySelector('[data-areas]');
  const routesEl = el.querySelector('[data-routes]');
  const remoteEl = el.querySelector('[data-remote]');
  const areaNames = new Map(index.areas.map((a) => [a.id, a.name]));

  let remoteTimer;
  function run() {
    const words = norm(q).split(/\s+/).filter(Boolean);
    const hit = (text) => words.every((w) => text.includes(w));
    const areas = words.length
      ? index.areas.filter((a) => hit(norm(`${a.name} ${areaNames.get(a.parent_id) || ''}`))).slice(0, 30)
      : [];
    const routes = words.length
      ? index.routes.filter((r) => hit(norm(`${r.name} ${r.area_name} ${r.grade}`)))
      : index.routes;

    areasEl.innerHTML = areas.length ? `
      <h2 style="margin-bottom:10px">Areas</h2>
      <div class="list">${areas.map((a) => `
        <a class="card list-item" href="#/area/${a.id}">
          <span class="icon">${icons.area}</span>
          <span class="grow"><b>${esc(a.name)}</b><small>${esc(areaNames.get(a.parent_id) || '')}</small></span>
        </a>`).join('')}</div>` : '';

    routesEl.innerHTML = `<h2>${words.length ? 'Routes' : 'Route finder'}</h2>
      ${words.length ? '' : '<p class="muted small" style="margin:4px 0 0">Every route in your library. Filter by type, grade and stars.</p>'}
      <div data-explorer></div>`;
    if (routes.length) {
      mountRouteExplorer(routesEl.querySelector('[data-explorer]'), routes, { grouped: false, initial: { sort: 'stars' } });
    } else {
      routesEl.querySelector('[data-explorer]').innerHTML = '<p class="muted">No routes match in your library.</p>';
    }

    clearTimeout(remoteTimer);
    if (api.mode === 'server' && q.trim().length >= 2) {
      remoteEl.innerHTML = '<h2 style="margin-bottom:10px">On Mountain Project</h2>' + spinner();
      remoteTimer = setTimeout(async () => {
        try {
          const { results } = await api.remoteSearch(q.trim());
          remoteEl.innerHTML = `<h2 style="margin-bottom:10px">On Mountain Project</h2>${remoteResults(results)}`;
        } catch (err) {
          remoteEl.innerHTML = `<p class="muted small">Mountain Project search failed: ${esc(err.message)}</p>`;
        }
      }, 450);
    } else {
      remoteEl.innerHTML = '';
    }
  }

  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      q = input.value;
      history.replaceState(null, '', `#/search${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      run();
    }, 200);
  });
  remoteEl.addEventListener('click', downloadRouteCrag);
  run();
  return () => clearTimeout(remoteTimer);
}

export async function downloadRouteCrag(e) {
  const btn = e.target.closest('[data-dl-route]');
  if (!btn) return;
  btn.disabled = true;
  try {
    await api.startDownload({ id: Number(btn.dataset.dlRoute), kind: 'route' });
    location.hash = '#/downloads';
  } catch (err) {
    btn.disabled = false;
    alert(err.message);
  }
}
