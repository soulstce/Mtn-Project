import { prefs } from '../prefs.js';
import { esc, gradeBadge, empty, plural, typeTags } from '../ui.js';

function toCsv(ticks) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Date', 'Route', 'Grade', 'Area', 'Style', 'Notes', 'Mountain Project URL']];
  for (const [id, t] of ticks) {
    rows.push([t.date, t.name, t.grade, t.area_name, t.style, t.notes, `https://www.mountainproject.com/route/${id}`]);
  }
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}

export function renderTicks(el, params) {
  const tab = params.get('tab') === 'todo' ? 'todo' : 'ticks';
  const ticks = Object.entries(prefs.get('ticks')).sort((a, b) => (b[1].date || '').localeCompare(a[1].date || ''));
  const todos = Object.entries(prefs.get('todos')).sort((a, b) => (a[1].grade_key ?? 0) - (b[1].grade_key ?? 0));

  // Pyramid: hardest grades ticked, by grade.
  const pyramid = new Map();
  for (const [, t] of ticks) if (t.grade) pyramid.set(t.grade, { n: (pyramid.get(t.grade)?.n || 0) + 1, t });
  const pyr = [...pyramid.entries()].sort((a, b) => (b[1].t.grade_key ?? 0) - (a[1].t.grade_key ?? 0)).slice(0, 8);
  const maxN = Math.max(1, ...pyr.map(([, v]) => v.n));

  const list = tab === 'ticks' ? ticks : todos;
  el.innerHTML = `
    <header class="page-head"><div><h1>Ticks & to-dos</h1>
      <p class="muted">${plural(ticks.length, 'tick')} · ${plural(todos.length, 'to-do')} · stored on this device</p></div>
      ${ticks.length ? '<button class="btn" data-export>Export CSV</button>' : ''}
    </header>
    <div class="seg" role="tablist">
      <button class="${tab === 'ticks' ? 'on' : ''}" data-tab="ticks">Ticks</button>
      <button class="${tab === 'todo' ? 'on' : ''}" data-tab="todo">To-do</button>
    </div>

    ${tab === 'ticks' && pyr.length > 1 ? `
      <section class="card pad section">
        <h3 style="margin-bottom:10px">Your pyramid</h3>
        ${pyr.map(([grade, v]) => `
          <div style="display:flex;align-items:center;gap:10px;margin:4px 0">
            <span style="width:70px">${gradeBadge(v.t)}</span>
            <span class="progress" style="flex:1;height:14px"><i style="width:${(v.n / maxN) * 100}%"></i></span>
            <span class="small muted" style="width:24px">${v.n}</span>
          </div>`).join('')}
      </section>` : ''}

    <section class="section list">
      ${list.length ? list.map(([id, t]) => `
        <a class="card list-item" href="#/route/${id}">
          ${gradeBadge(t)}
          <span class="grow">
            <b>${esc(t.name)}</b>
            <small>${esc(t.area_name || '')}${tab === 'ticks' ? ` · ${esc(t.date)}${t.style ? ` · ${esc(t.style)}` : ''}` : ''}</small>
          </span>
          <span>${typeTags(t.types)}</span>
        </a>`).join('') : empty(
          tab === 'ticks' ? 'No ticks yet' : 'No to-dos yet',
          tab === 'ticks' ? 'Open a route and tap <b>Tick</b> after you send it.' : 'Tap <b>To-do</b> on any route to build your hit list.',
        )}
    </section>
  `;

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]')?.dataset.tab;
    if (t) location.hash = t === 'todo' ? '#/ticks?tab=todo' : '#/ticks';
    if (e.target.closest('[data-export]')) {
      const blob = new Blob([toCsv(ticks)], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ticks-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  });
}
