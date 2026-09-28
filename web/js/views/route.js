import { api } from '../api.js';
import { prefs } from '../prefs.js';
import {
  esc, icons, spinner, crumbs, stars, typeTags, gradeBadge, photoStrip, photoGrid, bindPhotos,
  mapsUrl, mpUrl, toast, plural, ROCK_SYSTEMS, BOULDER_SYSTEMS,
} from '../ui.js';

const STYLES = ['', 'Onsight', 'Flash', 'Redpoint', 'Pinkpoint', 'Send', 'Follow', 'TR', 'Solo', 'Attempt'];

async function load(id) {
  try {
    const route = await api.route(id);
    if (!route.has_detail && api.mode === 'server') {
      // Only the summary was downloaded: borrow text + photos live, for display.
      try {
        const live = await api.remoteRoute(id);
        return { ...route, sections: live.sections, photos: route.photos?.length ? route.photos : live.photos.map(remotePhoto), live: true };
      } catch { /* fine, show the summary */ }
    }
    return route;
  } catch (err) {
    if (err.status !== 404 || api.mode !== 'server') throw err;
    const live = await api.remoteRoute(id);
    return { ...live, photos: live.photos.map(remotePhoto), live: true, notDownloaded: true };
  }
}

const remotePhoto = (p) => ({ id: p.id, title: p.title, thumb: p.thumb, full: p.medium });

export async function renderRoute(el, id) {
  el.innerHTML = spinner();
  const route = await load(id);
  const index = await api.index().catch(() => ({ areas: [] }));
  const local = new Set(index.areas.map((a) => a.id));
  const photos = route.photos || [];
  const isBoulder = route.grade_key >= 20000 && route.grade_key < 30000;
  const systems = isBoulder ? BOULDER_SYSTEMS : ROCK_SYSTEMS;
  const altGrades = Object.entries(systems)
    .filter(([k]) => route.grades?.[k])
    .map(([k, label]) => `${label} <b>${esc(route.grades[k])}</b>`);

  const facts = [
    typeTags(route.types),
    route.length_ft ? `<span><b>${route.length_ft} ft</b> (${Math.round(route.length_ft * 0.3048)} m)</span>` : '',
    route.pitches ? `<span><b>${route.pitches}</b> ${route.pitches === 1 ? 'pitch' : 'pitches'}</span>` : '',
    route.commitment ? `<span>Grade <b>${esc(route.commitment)}</b></span>` : '',
    route.grade_extra ? `<span>Also <b>${esc(route.grade_extra)}</b></span>` : '',
  ].filter(Boolean).join('');

  el.innerHTML = `
    ${route.notDownloaded ? '<p class="notice">Not in your library – showing it live from Mountain Project.</p>' : ''}
    ${route.live && !route.notDownloaded ? '<p class="notice small">Details shown live – only a summary of this route is saved offline.</p>' : ''}
    ${photos.length ? `<div style="margin-top:4px">${photoStrip(photos.slice(0, 8))}</div>` : ''}

    <div class="route-head">
      <div class="title">
        ${crumbs(route.breadcrumbs, { local })}
        <h1>${esc(route.name)}</h1>
        <div class="facts">
          ${route.stars != null ? `${stars(route.stars, route.votes)}<span>${route.stars.toFixed(1)}${route.votes ? ` · ${plural(route.votes, 'vote')}` : ''}</span>` : ''}
        </div>
      </div>
      ${gradeBadge(route, true)}
    </div>
    <div class="facts" style="margin-top:10px">${facts}</div>
    ${altGrades.length > 1 ? `<div class="alt-grades">${altGrades.join(' · ')}</div>` : ''}
    ${route.fa ? `<p class="small muted" style="margin:10px 0 0"><b>FA</b> ${esc(route.fa.replace(/^FA:\s*/, ''))}</p>` : ''}

    <div class="actions">
      <button class="btn" data-act="tick">${icons.check} <span>Tick</span></button>
      <button class="btn" data-act="todo">${icons.star} <span>To-do</span></button>
      ${route.lat != null ? `<a class="btn" href="${mapsUrl(route.lat, route.lng)}" target="_blank" rel="noopener">${icons.map} Directions</a>` : ''}
      <a class="btn" href="${mpUrl('route', id)}" target="_blank" rel="noopener">${icons.link} Mountain Project</a>
    </div>

    <div data-tick-card></div>

    <section class="section">
      ${(route.sections || []).map((s) => `
        <details class="card block" open>
          <summary>${esc(s.title)}</summary>
          <div class="prose">${s.html}</div>
        </details>`).join('') || '<p class="muted">No description saved for this route.</p>'}
    </section>

    ${photos.length > 8 ? `<section class="section"><h2 style="margin-bottom:10px">All photos</h2>${photoGrid(photos)}</section>` : ''}

    ${route.position?.of > 1 ? `
      <nav class="wall-nav" aria-label="Neighbouring routes">
        ${route.prev ? `<a class="card prev" href="#/route/${route.prev.id}"><small>‹ Left</small><b>${esc(route.prev.name)}</b></a>` : '<span></span>'}
        <div class="pos">${route.position.index} of ${route.position.of}<br>at ${esc(route.area_name || 'this wall')}</div>
        ${route.next ? `<a class="card next" href="#/route/${route.next.id}"><small>Right ›</small><b>${esc(route.next.name)}</b></a>` : '<span></span>'}
      </nav>` : ''}
  `;

  bindPhotos(el, photos);
  const tickCard = el.querySelector('[data-tick-card]');
  const snapshot = { ...route, id };

  function drawButtons() {
    const tick = prefs.tick(id);
    const todo = prefs.todo(id);
    const tickBtn = el.querySelector('[data-act="tick"]');
    const todoBtn = el.querySelector('[data-act="todo"]');
    tickBtn.classList.toggle('on', !!tick);
    tickBtn.querySelector('span').textContent = tick ? `Ticked ${tick.date}` : 'Tick';
    todoBtn.classList.toggle('on', !!todo);
    todoBtn.querySelector('span').textContent = todo ? 'On to-do list' : 'To-do';
    tickCard.innerHTML = tick ? `
      <div class="card pad" style="margin-top:12px">
        <div class="two">
          <div class="field"><label for="tick-date">Date</label><input id="tick-date" class="input" type="date" data-tick="date" value="${esc(tick.date)}"></div>
          <div class="field"><label for="tick-style">Style</label><select id="tick-style" class="input" data-tick="style">
            ${STYLES.map((s) => `<option value="${s}"${s === tick.style ? ' selected' : ''}>${s || '—'}</option>`).join('')}
          </select></div>
        </div>
        <div class="field" style="margin-top:10px"><label for="tick-notes">Notes</label>
          <textarea id="tick-notes" class="input" data-tick="notes" placeholder="Beta, conditions, who you climbed with…">${esc(tick.notes)}</textarea></div>
      </div>` : '';
  }

  tickCard.addEventListener('change', (e) => {
    const field = e.target.dataset.tick;
    if (field) prefs.updateTick(id, { [field]: e.target.value });
    if (field === 'date') drawButtons();
  });
  tickCard.addEventListener('input', (e) => {
    if (e.target.dataset.tick === 'notes') prefs.updateTick(id, { notes: e.target.value });
  });

  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'tick') {
      toast(prefs.toggleTick(snapshot) ? 'Ticked! Nice send.' : 'Tick removed');
      drawButtons();
    } else if (act === 'todo') {
      toast(prefs.toggleTodo(snapshot) ? 'Added to your to-do list' : 'Removed from to-dos');
      drawButtons();
    }
  });

  // Arrow keys walk along the wall.
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select') || !document.getElementById('lightbox').hidden) return;
    if (e.key === 'ArrowLeft' && route.prev) location.hash = `#/route/${route.prev.id}`;
    if (e.key === 'ArrowRight' && route.next) location.hash = `#/route/${route.next.id}`;
  };
  document.addEventListener('keydown', onKey);

  drawButtons();
  return () => document.removeEventListener('keydown', onKey);
}
