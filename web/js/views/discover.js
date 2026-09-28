import { api } from '../api.js';
import {
  esc, icons, spinner, plural, crumbs, stars, typeTags, typeBar, gradeBadge, empty, toast,
} from '../ui.js';
import { remoteResults, downloadRouteCrag } from './search.js';

function requireServer(el) {
  if (api.mode === 'server') return true;
  el.innerHTML = empty(
    'Discover needs the library server',
    'Browsing and downloading from Mountain Project runs on your computer. Start it with <span class="kbd">python -m mtnproj serve</span>.',
    '<a class="btn" href="#/">Back to library</a>',
  );
  return false;
}

export async function renderDiscover(el) {
  if (!requireServer(el)) return;
  el.innerHTML = `
    <header class="page-head"><div><h1>Discover</h1>
      <p class="muted">Find an area on Mountain Project and download it for offline use.</p></div></header>
    <div class="search-box">${icons.search}
      <input class="input" id="mpq" type="search" placeholder="Search Mountain Project: crag, area or route…" autocomplete="off" autofocus>
    </div>
    <section class="section" data-results></section>
    <form class="card pad section" data-url-form>
      <h3 style="margin-bottom:8px">Have a link?</h3>
      <div class="filter-row">
        <input class="input grow" name="url" placeholder="https://www.mountainproject.com/area/…" inputmode="url">
        <button class="btn primary" type="submit">Open</button>
      </div>
    </form>
    <section class="section">
      <div class="section-head"><h2>Browse by region</h2></div>
      <div data-guide>${spinner()}</div>
    </section>
  `;
  const results = el.querySelector('[data-results]');
  const input = el.querySelector('#mpq');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = ''; return; }
    results.innerHTML = spinner();
    timer = setTimeout(async () => {
      try {
        const { results: list } = await api.remoteSearch(q);
        if (input.value.trim() === q) results.innerHTML = remoteResults(list);
      } catch (err) {
        results.innerHTML = `<p class="notice">${esc(err.message)}</p>`;
      }
    }, 350);
  });
  results.addEventListener('click', downloadRouteCrag);

  el.querySelector('[data-url-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = new FormData(e.target).get('url');
    const area = url.match(/\/area\/(\d+)/);
    const route = url.match(/\/route\/(\d+)/);
    if (area) location.hash = `#/discover/area/${area[1]}`;
    else if (route) location.hash = `#/route/${route[1]}`;
    else toast('That does not look like a Mountain Project area or route link');
  });

  try {
    const { areas } = await api.remoteGuide();
    el.querySelector('[data-guide]').innerHTML = `<div class="chips">${areas.map((a) =>
      `<a class="chip" href="#/discover/area/${a.id}">${esc(a.name)}${a.total ? ` <span class="muted">${a.total.toLocaleString()}</span>` : ''}</a>`).join('')}</div>`;
  } catch (err) {
    el.querySelector('[data-guide]').innerHTML = `<p class="notice">Could not reach Mountain Project: ${esc(err.message)}</p>`;
  }
}

function estimate(total, opts) {
  if (!total) return '';
  const secs = total * ((opts.route_details ? 1.05 : 0.08) + (opts.photos && opts.route_details ? 0.5 : 0.02));
  const mb = opts.photos ? total * (opts.route_details ? 1.6 : 0.1) * (opts.photo_size === 'large' ? 0.45 : 0.14) : 0;
  const time = secs < 90 ? `${Math.max(1, Math.round(secs))} sec` : secs < 5400 ? `${Math.round(secs / 60)} min` : `${(secs / 3600).toFixed(1)} h`;
  return `≈ ${time}${mb ? ` · ~${mb < 1 ? '<1' : Math.round(mb)} MB of photos` : ''} (rough guess)`;
}

export async function renderRemoteArea(el, id) {
  if (!requireServer(el)) return;
  el.innerHTML = spinner();
  const area = await api.remoteArea(id);
  const index = await api.index().catch(() => ({ areas: [] }));
  const local = new Set(index.areas.map((a) => a.id));
  const total = area.total_climbs ?? area.routes.length;
  const cover = area.photos[0]?.medium;
  const intro = area.sections.find((s) => s.title === 'Description') || area.sections[0];

  el.innerHTML = `
    <section class="hero">
      ${cover ? `<img class="bg" src="${esc(cover)}" alt="" onerror="this.remove()">` : ''}
      <div class="inner">
        ${crumbs(area.breadcrumbs, { local })}
        <h1>${esc(area.name)}</h1>
        <div class="sub">
          <span>${plural(total, 'route')}</span>
          ${area.children.length ? `<span>${plural(area.children.length, 'sub-area')}</span>` : ''}
          ${area.elevation ? `<span>${esc(area.elevation)}</span>` : ''}
        </div>
      </div>
    </section>

    ${area.downloaded ? `<p class="notice" style="margin-top:14px">In your library. <a href="#/area/${id}"><b>Open it ›</b></a></p>` : ''}

    <form class="card pad section" data-dl>
      <div class="section-head"><h2>${area.downloaded ? 'Update download' : 'Download for offline'}</h2></div>
      <div class="options">
        <label class="option"><input type="checkbox" name="route_details" checked>
          <span>Full route details<small>Description, location, protection and photos for every route. Unticked = names, grades & stars only (much faster).</small></span></label>
        <label class="option"><input type="checkbox" name="photos" checked>
          <span>Photos<small>Saved to your library so they work with no signal.</small></span></label>
        <div class="two">
          <div class="field"><label for="dl-depth">Sub-areas</label>
            <select id="dl-depth" class="input" name="max_depth">
              <option value="">Everything inside</option>
              <option value="0">This area only</option>
              <option value="1">One level down</option>
              <option value="2">Two levels down</option>
            </select></div>
          <div class="field"><label for="dl-count">Photos per page</label>
            <select id="dl-count" class="input" name="max_photos">
              <option value="4">4</option><option value="8">8</option>
              <option value="12" selected>12</option><option value="24">24</option>
            </select></div>
        </div>
        <div class="field"><label for="dl-size">Photo quality</label>
          <select id="dl-size" class="input" name="photo_size">
            <option value="medium" selected>Standard (~100 KB each)</option>
            <option value="large">High (~400 KB each)</option>
          </select></div>
      </div>
      <div class="filter-row" style="margin-top:14px;justify-content:space-between">
        <span class="muted small" data-estimate></span>
        <button class="btn primary" type="submit">${icons.download} ${area.downloaded ? 'Update' : 'Download'} ${esc(area.name)}</button>
      </div>
    </form>

    ${area.children.length ? `
      <section class="section">
        <h2 style="margin-bottom:10px">Areas</h2>
        <div class="list">${area.children.map((c) => `
          <a class="card list-item" href="#/discover/area/${c.id}">
            <span class="grow"><b>${esc(c.name)}</b>
              <small>${c.total != null ? plural(c.total, 'route') : ''}${local.has(c.id) ? ' · ✓ downloaded' : ''}</small>
              <span style="display:block;margin-top:6px">${typeBar(Object.fromEntries(Object.entries(c.type_counts || {}).map(([k, v]) => [k === 'Toprope' ? 'TR' : k, v])))}</span>
            </span>
            <span class="muted">›</span>
          </a>`).join('')}</div>
      </section>` : ''}

    ${area.routes.length ? `
      <section class="section">
        <h2 style="margin-bottom:10px">Routes</h2>
        <div class="list">${area.routes.map((r, i) => `
          <a class="card list-item" href="#/route/${r.id}">
            <span class="muted small" style="width:20px;text-align:right">${i + 1}</span>
            <span class="grow"><b>${esc(r.name)}</b><small>${stars(r.stars)} ${typeTags(r.types)}</small></span>
            ${gradeBadge(r)}
          </a>`).join('')}</div>
      </section>` : ''}

    ${intro ? `<details class="card block section"><summary>${esc(intro.title)}</summary><div class="prose">${intro.html}</div></details>` : ''}
  `;

  const form = el.querySelector('[data-dl]');
  const read = () => {
    const f = new FormData(form);
    return {
      id,
      kind: 'area',
      route_details: f.has('route_details'),
      photos: f.has('photos'),
      max_depth: f.get('max_depth') === '' ? null : Number(f.get('max_depth')),
      max_photos: Number(f.get('max_photos')),
      photo_size: f.get('photo_size'),
      refresh_days: area.downloaded ? 0 : null,
    };
  };
  const updateEstimate = () => { el.querySelector('[data-estimate]').textContent = estimate(total, read()); };
  form.addEventListener('change', updateEstimate);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.startDownload(read());
      toast(`Downloading ${area.name}`);
      location.hash = '#/downloads';
    } catch (err) {
      toast(err.message);
    }
  });
  updateEstimate();
}
