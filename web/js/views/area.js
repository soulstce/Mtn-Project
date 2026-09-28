import { api, saveOffline, removeOffline } from '../api.js';
import { prefs } from '../prefs.js';
import {
  esc, icons, plural, spinner, crumbs, typeBar, photoGrid, bindPhotos, mapsUrl, mpUrl, toast, timeAgo,
} from '../ui.js';
import { mountRouteExplorer } from './routelist.js';
import { areaCard } from './library.js';

export async function renderArea(el, id, params) {
  el.innerHTML = spinner();
  const [area, { routes }, index] = await Promise.all([
    api.area(id),
    api.areaRoutes(id),
    api.index().catch(() => ({ areas: [] })),
  ]);
  const local = new Set(index.areas.map((a) => a.id));
  const children = area.children || [];
  const photos = area.photos || [];
  const typeCounts = {};
  for (const r of routes) for (const t of r.types || []) typeCounts[t] = (typeCounts[t] || 0) + 1;
  const rated = routes.filter((r) => r.stars != null);
  const avgStars = rated.length ? rated.reduce((s, r) => s + r.stars, 0) / rated.length : null;
  const classics = routes.filter((r) => (r.stars ?? 0) >= 3).length;
  const detailed = area.stats?.detailed ?? 0;

  const tabs = [
    ['routes', 'Routes', routes.length],
    ...(children.length ? [['areas', 'Areas', children.length]] : []),
    ['info', 'Info', null],
    ...(photos.length ? [['photos', 'Photos', photos.length]] : []),
  ];
  let tab = params.get('tab') || (children.length ? 'areas' : 'routes');
  if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0];

  const saved = prefs.offlineAreas()[id];
  // Saving an area also saves everything beneath it.
  const savedParent = (area.breadcrumbs || []).map((c) => c.id).reverse()
    .find((pid) => prefs.offlineAreas()[pid]);

  el.innerHTML = `
    <section class="hero">
      ${area.cover ? `<img class="bg" src="${esc(area.cover)}" alt="" onerror="this.remove()">` : ''}
      <div class="inner">
        ${crumbs(area.breadcrumbs, { local })}
        <h1>${esc(area.name)}</h1>
        <div class="sub">
          <span>${plural(routes.length, 'route')}</span>
          ${children.length ? `<span>${plural(children.length, 'area')}</span>` : ''}
          ${area.elevation ? `<span>${esc(area.elevation)}</span>` : ''}
          ${area.fetched_at ? `<span>updated ${timeAgo(area.fetched_at)}</span>` : ''}
        </div>
      </div>
    </section>

    <div class="actions">
      ${savedParent && !saved
        ? `<a class="btn on" href="#/area/${savedParent}" title="Saved as part of ${esc(prefs.offlineAreas()[savedParent].name)}">${icons.phone} Saved on device</a>`
        : `<button class="btn ${saved ? 'on' : 'primary'}" data-act="offline">
        ${icons.phone} ${saved ? 'Saved on device' : 'Save to device'}
      </button>`}
      ${area.lat != null ? `<a class="btn" href="${mapsUrl(area.lat, area.lng)}" target="_blank" rel="noopener">${icons.map} Directions</a>` : ''}
      <button class="btn server-only" data-act="update">${icons.refresh} Update</button>
      <a class="btn" href="${mpUrl('area', id)}" target="_blank" rel="noopener">${icons.link} Mountain Project</a>
      ${area.is_root ? `<button class="btn danger server-only" data-act="delete">${icons.trash} Delete</button>` : ''}
    </div>

    <div class="stats">
      <div class="card stat"><b>${routes.length.toLocaleString()}</b><span>routes</span></div>
      <div class="card stat"><b>${classics}</b><span>3★+ classics</span></div>
      <div class="card stat"><b>${avgStars ? avgStars.toFixed(1) : '–'}</b><span>avg stars</span></div>
      <div class="card stat"><b>${(area.stats?.photos ?? photos.length).toLocaleString()}</b><span>photos</span></div>
    </div>
    ${Object.keys(typeCounts).length ? `
      <div class="card pad" style="display:flex;flex-direction:column;gap:8px">
        ${typeBar(typeCounts)}
        <div class="chips small">${Object.entries(typeCounts).sort((a, b) => b[1] - a[1])
          .map(([t, n]) => `<span class="type type-${esc(t)}">${esc(t)} ${n}</span>`).join('')}</div>
      </div>` : ''}
    ${detailed < routes.length ? `
      <p class="notice small" style="margin-top:12px">
        ${detailed ? `${detailed} of ${routes.length}` : 'None of the'} routes here have full details
        (description, protection, photos) downloaded.
        <span class="server-only">Use <b>Update</b> to fetch them.</span>
      </p>` : ''}

    <div class="tabs" role="tablist">
      ${tabs.map(([k, label, n]) => `<button class="tab${k === tab ? ' on' : ''}" data-tab="${k}" role="tab">${label}${n != null ? `<span class="count">${n.toLocaleString()}</span>` : ''}</button>`).join('')}
    </div>
    <div data-panel></div>
  `;

  const panel = el.querySelector('[data-panel]');

  function show(name) {
    tab = name;
    el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    history.replaceState(null, '', `#/area/${id}?tab=${name}`);
    if (name === 'routes') {
      if (!routes.length) {
        panel.innerHTML = '<div class="empty"><p>No routes downloaded for this area yet.</p></div>';
        return;
      }
      mountRouteExplorer(panel, routes, { grouped: children.length > 0, hasWallOrder: true });
      return;
    }
    if (name === 'areas') {
      panel.innerHTML = `<div class="grid tight" style="margin-top:16px">${children.map((c) => c.downloaded
        ? areaCard({ ...c, stats: c.stats })
        : areaCard(c, { href: `#/discover/area/${c.id}`, remote: true, badge: 'Not downloaded' })).join('')}</div>`;
      return;
    }
    if (name === 'photos') {
      panel.innerHTML = `<div style="margin-top:16px">${photoGrid(photos)}</div>`;
      bindPhotos(panel, photos);
      return;
    }
    const facts = [
      area.lat != null ? `<div><b>GPS</b> <a class="map-link" href="${mapsUrl(area.lat, area.lng)}" target="_blank" rel="noopener">${area.lat}, ${area.lng}</a></div>` : '',
      area.elevation ? `<div><b>Elevation</b> ${esc(area.elevation)}</div>` : '',
      area.total_climbs ? `<div><b>On Mountain Project</b> ${plural(area.total_climbs, 'climb')}</div>` : '',
    ].filter(Boolean).join('');
    panel.innerHTML = `
      <div style="margin-top:16px">
        ${facts ? `<div class="card pad facts" style="margin-bottom:12px;flex-direction:column;align-items:flex-start">${facts}</div>` : ''}
        ${(area.sections || []).map((s, i) => `
          <details class="card block" ${i < 2 ? 'open' : ''}>
            <summary>${esc(s.title)}</summary>
            <div class="prose">${s.html}</div>
          </details>`).join('') || '<p class="muted">No description for this area.</p>'}
      </div>`;
  }

  el.addEventListener('click', async (e) => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) return show(tabBtn.dataset.tab);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const btn = e.target.closest('[data-act]');
    if (act === 'offline') {
      if (prefs.offlineAreas()[id]) {
        await removeOffline(id);
        btn.classList.replace('on', 'primary');
        btn.innerHTML = `${icons.phone} Save to device`;
        toast('Removed from this device');
        return;
      }
      btn.disabled = true;
      try {
        const res = await saveOffline(id, area.name, (done, total) => {
          btn.innerHTML = `${icons.phone} Saving ${Math.round((done / total) * 100)}%`;
        });
        btn.classList.replace('primary', 'on');
        btn.innerHTML = `${icons.phone} Saved on device`;
        toast(res.failed ? `Saved (${res.failed} files failed)` : `Saved ${plural(res.total, 'file')} for offline use`);
      } catch (err) {
        btn.innerHTML = `${icons.phone} Save to device`;
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
    } else if (act === 'update') {
      try {
        await api.startDownload({ id, kind: 'area', refresh_days: 0 });
        toast('Update started');
        location.hash = '#/downloads';
      } catch (err) {
        toast(err.message);
      }
    } else if (act === 'delete') {
      if (!confirm(`Delete ${area.name} and everything under it from your library?`)) return;
      await api.deleteArea(id);
      toast(`Deleted ${area.name}`);
      location.hash = '#/';
    }
  });

  show(tab);
}
