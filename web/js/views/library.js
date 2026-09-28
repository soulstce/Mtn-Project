import { api } from '../api.js';
import { prefs } from '../prefs.js';
import { esc, icons, plural, spinner, empty, gradeBadge, timeAgo } from '../ui.js';

export function areaCard(area, { href = `#/area/${area.id}`, remote = false, badge = '' } = {}) {
  const s = area.stats || {};
  const where = (area.breadcrumbs || []).map((c) => c.name).join(' › ');
  const cover = area.cover
    ? `<img loading="lazy" src="${esc(area.cover)}" alt="" onerror="this.remove()">`
    : '';
  const routesLabel = remote
    ? (area.total != null ? plural(area.total, 'route') : '')
    : plural(s.routes, 'route');
  return `
    <a class="card area-card${remote ? ' remote' : ''}" href="${href}">
      <div class="cover">${cover}${badge ? `<span class="badge">${badge}</span>` : ''}</div>
      <div class="body">
        ${where ? `<div class="where">${esc(where)}</div>` : ''}
        <h3>${esc(area.name)}</h3>
        <div class="meta">
          ${routesLabel ? `<span>${routesLabel}</span>` : ''}
          ${!remote && s.areas > 1 ? `<span>${plural(s.areas - 1, 'sub-area')}</span>` : ''}
          ${!remote && s.photos ? `<span>${plural(s.photos, 'photo')}</span>` : ''}
          ${area.fetched_at ? `<span>updated ${timeAgo(area.fetched_at)}</span>` : ''}
        </div>
      </div>
    </a>`;
}

export async function renderLibrary(el) {
  el.innerHTML = spinner();
  let areas = [];
  try {
    ({ areas } = await api.library());
  } catch (err) {
    if (err.status !== 503) throw err;
  }
  const offline = prefs.offlineAreas();
  const todos = Object.entries(prefs.get('todos'))
    .sort((a, b) => b[1].added - a[1].added)
    .slice(0, 5);

  const totalRoutes = areas.reduce((n, a) => n + (a.stats?.routes || 0), 0);

  el.innerHTML = `
    <header class="page-head">
      <div>
        <h1>Your library</h1>
        <p class="muted">${areas.length
          ? `${plural(areas.length, 'area')} · ${plural(totalRoutes, 'route')} ready to go`
          : 'Nothing downloaded yet'}</p>
      </div>
      <a class="btn primary server-only" href="#/discover">${icons.download} Add area</a>
    </header>

    <form class="search-box" id="lib-search" role="search">
      ${icons.search}
      <input class="input" name="q" type="search" placeholder="Search your routes & areas…" autocomplete="off">
    </form>

    ${areas.length ? `
      <section class="section">
        <div class="grid">
          ${areas.map((a) => areaCard(a, { badge: offline[a.id] ? '✓ On device' : '' })).join('')}
        </div>
      </section>` : empty(
        'Build your offline guidebook',
        api.mode === 'server'
          ? 'Find a crag on Mountain Project and download it: routes, descriptions, beta and photos.'
          : 'This library is empty. Download areas with the desktop server, then export again.',
        api.mode === 'server' ? '<a class="btn primary" href="#/discover">Discover areas</a>' : '',
      )}

    ${todos.length ? `
      <section class="section">
        <div class="section-head"><h2>Up next</h2><a class="muted small" href="#/ticks">All to-dos ›</a></div>
        <div class="list">
          ${todos.map(([id, t]) => `
            <a class="card list-item" href="#/route/${id}">
              ${gradeBadge(t)}
              <span class="grow"><b>${esc(t.name)}</b><small>${esc(t.area_name || '')}</small></span>
            </a>`).join('')}
        </div>
      </section>` : ''}
  `;

  el.querySelector('#lib-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get('q').trim();
    location.hash = `#/search${q ? `?q=${encodeURIComponent(q)}` : ''}`;
  });
}
