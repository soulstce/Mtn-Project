import { api, clearMemo } from '../api.js';
import { esc, icons, empty, plural, toast, timeAgo } from '../ui.js';

function pct(job) {
  // Weight route pages most: they dominate the time spent.
  const parts = [
    [job.areas_done, job.areas_total, 1],
    [job.routes_done, job.routes_total, 3],
    [job.photos_done, job.photos_total, 1],
  ].filter(([, t]) => t > 0);
  if (job.status === 'done') return 100;
  if (!parts.length) return 2;
  const w = parts.reduce((s, [, , wt]) => s + wt, 0);
  return Math.max(2, Math.round(parts.reduce((s, [d, t, wt]) => s + (d / t) * wt, 0) / w * 100));
}

function jobCard(job) {
  const running = job.status === 'running' || job.status === 'queued';
  const target = job.root_area_id || job.target_id;
  return `
    <div class="card job">
      <div class="job-top">
        <b>${esc(job.name || `${job.kind === 'route' ? 'Route' : 'Area'} ${job.target_id}`)}</b>
        <span class="status ${job.status}">${job.status}</span>
      </div>
      <div class="progress"><i style="width:${pct(job)}%"></i></div>
      <div class="counts">
        <span>${job.areas_done}/${job.areas_total} areas</span>
        <span>${job.routes_done}/${job.routes_total} routes</span>
        ${job.options.photos ? `<span>${job.photos_done}/${job.photos_total} photos</span>` : ''}
        ${job.error_count ? `<span style="color:var(--danger)">${plural(job.error_count, 'error')}</span>` : ''}
        ${job.finished ? `<span>finished ${timeAgo(job.finished)}</span>` : ''}
      </div>
      ${running && job.current ? `<div class="small muted">${esc(job.current)}</div>` : ''}
      ${job.errors.length ? `<details class="small"><summary class="muted">Show errors</summary>${job.errors.map((e) => `<div>${esc(e)}</div>`).join('')}</details>` : ''}
      <div class="btn-row">
        ${running ? `<button class="btn danger" data-cancel="${job.id}">Cancel</button>` : ''}
        ${!running && job.status !== 'error' && target ? `<a class="btn" href="#/area/${target}">Open in library</a>` : ''}
      </div>
    </div>`;
}

export async function renderDownloads(el) {
  if (api.mode !== 'server') {
    el.innerHTML = empty('Downloads run on the library server', 'Start it with <span class="kbd">python -m mtnproj serve</span>.');
    return;
  }
  el.innerHTML = `
    <header class="page-head"><div><h1>Downloads</h1>
      <p class="muted">Pages are fetched politely (about one per second), so big areas take a while. You can keep using the app.</p></div>
      <a class="btn primary" href="#/discover">${icons.download} New</a></header>
    <div class="list" data-jobs></div>`;
  const list = el.querySelector('[data-jobs]');
  let timer;
  let wasActive = false;

  async function refresh() {
    try {
      const { jobs } = await api.downloads();
      const active = jobs.some((j) => j.status === 'running' || j.status === 'queued');
      list.innerHTML = jobs.length ? jobs.map(jobCard).join('') : empty(
        'No downloads yet',
        'Pick an area in Discover to download it.',
        '<a class="btn primary" href="#/discover">Discover</a>',
      );
      if (wasActive && !active) clearMemo(); // library changed
      wasActive = active;
      timer = setTimeout(refresh, active ? 1500 : 6000);
    } catch (err) {
      list.innerHTML = `<p class="notice">${esc(err.message)}</p>`;
      timer = setTimeout(refresh, 6000);
    }
  }
  list.addEventListener('click', async (e) => {
    const id = e.target.closest('[data-cancel]')?.dataset.cancel;
    if (!id) return;
    await api.cancelDownload(Number(id));
    toast('Cancelling…');
    clearTimeout(timer);
    refresh();
  });
  await refresh();
  return () => clearTimeout(timer);
}

/** Show a pulsing dot on the Downloads tab while jobs run. */
export function pollDownloadBadge() {
  const badge = document.getElementById('dl-badge');
  let wasActive = false;
  const tick = async () => {
    try {
      const { jobs } = await api.downloads();
      const active = jobs.some((j) => j.status === 'running' || j.status === 'queued');
      badge.hidden = !active;
      if (wasActive && !active) clearMemo();
      wasActive = active;
      setTimeout(tick, active ? 3000 : 15000);
    } catch {
      setTimeout(tick, 30000);
    }
  };
  tick();
}
