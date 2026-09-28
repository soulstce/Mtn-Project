import { api } from './api.js';
import { prefs } from './prefs.js';
import { $, $$, esc, empty } from './ui.js';
import { renderLibrary } from './views/library.js';
import { renderArea } from './views/area.js';
import { renderRoute } from './views/route.js';
import { renderSearch } from './views/search.js';
import { renderDiscover, renderRemoteArea } from './views/discover.js';
import { renderDownloads, pollDownloadBadge } from './views/downloads.js';
import { renderTicks } from './views/ticks.js';
import { renderSettings } from './views/settings.js';

const routes = [
  [/^\/?$/, 'library', () => renderLibrary],
  [/^\/area\/(\d+)$/, 'library', (m) => (el, q) => renderArea(el, Number(m[1]), q)],
  [/^\/route\/(\d+)$/, 'library', (m) => (el) => renderRoute(el, Number(m[1]))],
  [/^\/search$/, 'search', () => renderSearch],
  [/^\/discover$/, 'discover', () => renderDiscover],
  [/^\/discover\/area\/(\d+)$/, 'discover', (m) => (el) => renderRemoteArea(el, Number(m[1]))],
  [/^\/downloads$/, 'downloads', () => renderDownloads],
  [/^\/ticks$/, 'ticks', () => renderTicks],
  [/^\/settings$/, 'settings', () => renderSettings],
];

let cleanup = null;
let navToken = 0;

async function router() {
  const hash = location.hash.slice(1) || '/';
  const [path, query = ''] = hash.split('?');
  const params = new URLSearchParams(query);
  // Each render gets a fresh container so view-level listeners never pile up.
  const view = document.createElement('div');
  $('#view').replaceChildren(view);

  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  const token = ++navToken;

  for (const [re, nav, make] of routes) {
    const m = path.match(re);
    if (!m) continue;
    $$('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
    try {
      const result = await make(m)(view, params, () => token !== navToken);
      if (token === navToken) cleanup = result;
    } catch (err) {
      if (token !== navToken) return;
      console.error(err);
      view.innerHTML = empty(
        err.status === 404 ? 'Not in your library' : 'Something went wrong',
        esc(err.message),
        '<a class="btn" href="#/">Back to library</a>',
      );
    }
    return;
  }
  view.innerHTML = empty('Page not found', 'That link does not exist.', '<a class="btn" href="#/">Library</a>');
}

// Keep scroll position per history entry (handy when going back to long lists).
const scrolls = new Map();
let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  scrolls.set(lastHash, window.scrollY);
  lastHash = location.hash;
  router().then(() => {
    window.scrollTo(0, scrolls.get(location.hash) || 0);
  });
});

function applyMode(mode) {
  document.body.classList.toggle('static-mode', mode === 'static');
  document.body.classList.toggle('offline-mode', mode === 'offline');
  const labels = {
    server: '● Connected to your library server',
    static: '● Static library',
    offline: '○ Offline – showing saved areas',
  };
  $('#conn-status').textContent = labels[mode] || '';
}

async function start() {
  prefs.applyTheme();
  applyMode(await api.status());
  window.addEventListener('online', async () => applyMode(await api.status()));
  window.addEventListener('offline', () => applyMode('offline'));

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
  }
  if (api.mode === 'server') pollDownloadBadge();
  await router();
}

start();
