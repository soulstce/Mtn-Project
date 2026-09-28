import { api, removeOffline, storageEstimate } from '../api.js';
import { prefs } from '../prefs.js';
import { esc, plural, toast, ROCK_SYSTEMS, BOULDER_SYSTEMS, timeAgo } from '../ui.js';

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(bytes > 1e8 ? 0 : 1)} MB`;

export async function renderSettings(el) {
  const offline = Object.entries(prefs.offlineAreas());
  const est = await storageEstimate();
  const select = (name, options, value) => `
    <select class="input" data-pref="${name}">
      ${Object.entries(options).map(([k, label]) => `<option value="${k}"${k === value ? ' selected' : ''}>${label}</option>`).join('')}
    </select>`;

  el.innerHTML = `
    <header class="page-head"><div><h1>Settings</h1></div></header>

    <section class="card pad section options">
      <h2>Display</h2>
      <div class="two">
        <div class="field"><label>Rock grades</label>${select('rockSystem', ROCK_SYSTEMS, prefs.get('rockSystem'))}</div>
        <div class="field"><label>Boulder grades</label>${select('boulderSystem', BOULDER_SYSTEMS, prefs.get('boulderSystem'))}</div>
      </div>
      <div class="field"><label>Theme</label>${select('theme', { auto: 'Match system', light: 'Light', dark: 'Dark' }, prefs.get('theme'))}</div>
    </section>

    <section class="card pad section">
      <h2 style="margin-bottom:6px">Saved on this device</h2>
      <p class="muted small" style="margin:0 0 12px">
        Areas you saved with <b>Save to device</b> open with no signal.
        ${est ? `Using ${mb(est.usage || 0)} of ${mb(est.quota || 0)} available.` : ''}
      </p>
      ${offline.length ? `<div class="list">${offline.map(([id, a]) => `
        <div class="list-item" style="padding:6px 0">
          <span class="grow"><b>${esc(a.name)}</b><small>${plural(a.files, 'file')} · saved ${timeAgo(a.savedAt / 1000)}</small></span>
          <a class="btn" href="#/area/${id}">Open</a>
          <button class="btn danger" data-remove="${id}">Remove</button>
        </div>`).join('')}</div>` : '<p class="muted">Nothing saved yet. Open an area and tap <b>Save to device</b>.</p>'}
    </section>

    <section class="card pad section">
      <h2 style="margin-bottom:6px">Get it on your phone</h2>
      <div class="prose small">
        <p><b>Same Wi-Fi:</b> run <span class="kbd">python -m mtnproj serve --host 0.0.0.0</span> and open
          <span class="kbd">http://&lt;computer-ip&gt;:8000</span> on your phone. Great for browsing at home.</p>
        <p><b>Truly offline at the crag:</b> run <span class="kbd">python -m mtnproj export site</span> and host
          the <span class="kbd">site</span> folder on any HTTPS static host. Open it on your phone, use
          <i>Add to Home Screen</i>, then <b>Save to device</b> on each area you want.</p>
      </div>
    </section>

    <section class="card pad section">
      <h2 style="margin-bottom:6px">About</h2>
      <p class="small muted" style="margin:0">
        Mode: <b>${esc(api.mode)}</b>. Content comes from
        <a class="map-link" href="https://www.mountainproject.com" target="_blank" rel="noopener">Mountain Project</a>
        and its contributors. This is a personal offline copy – please support the original site and keep your
        library private.
      </p>
    </section>
  `;

  el.addEventListener('change', (e) => {
    const key = e.target.dataset.pref;
    if (!key) return;
    prefs.set(key, e.target.value);
    if (key === 'theme') prefs.applyTheme();
    toast('Saved');
  });
  el.addEventListener('click', async (e) => {
    const id = e.target.closest('[data-remove]')?.dataset.remove;
    if (!id) return;
    await removeOffline(Number(id));
    e.target.closest('.list-item').remove();
    toast('Removed from this device');
  });
}
