// Data access. Every library URL is relative and ends in .json so the same
// front end runs against the Python server or a static export.

import { prefs } from './prefs.js';

export const DATA_CACHE = 'crag-data-v1';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(url, options = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, ...options });
  } catch {
    throw new ApiError('You appear to be offline.', 0);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* not JSON */ }
    throw new ApiError(detail, res.status);
  }
  return res.json();
}

const post = (url, body) => request(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify(body ?? {}),
});

// Small in-memory cache so tab switches and back navigation are instant.
const memo = new Map();
async function cached(url) {
  if (memo.has(url)) return memo.get(url);
  const value = await request(url);
  memo.set(url, value);
  return value;
}
export const clearMemo = () => memo.clear();

export const api = {
  mode: 'server',

  async status() {
    try {
      const s = await request('api/status.json', { cache: 'no-store' });
      this.mode = s.mode;
    } catch {
      this.mode = 'offline';
    }
    return this.mode;
  },

  library: () => request('api/library.json'),
  index: () => cached('api/index.json'),
  area: (id) => cached(`api/areas/${id}.json`),
  areaRoutes: (id) => cached(`api/areas/${id}/routes.json`),
  route: (id) => cached(`api/routes/${id}.json`),

  // Server-only: live Mountain Project + downloads.
  remoteSearch: (q) => request(`api/remote/search?q=${encodeURIComponent(q)}`),
  remoteGuide: () => cached('api/remote/guide'),
  remoteArea: (id) => request(`api/remote/area/${id}`),
  remoteRoute: (id) => request(`api/remote/route/${id}`),
  downloads: () => request('api/downloads'),
  startDownload: (body) => post('api/downloads', body),
  cancelDownload: (id) => post(`api/downloads/${id}/cancel`),
  async deleteArea(id) {
    const res = await request(`api/areas/${id}`, { method: 'DELETE' });
    clearMemo();
    await removeOffline(id);
    return res;
  },
};

// ------------------------------------------------------------ on-device

const manifestKey = (areaId) => `offline-manifest/${areaId}.json`;

async function readManifest(cache, areaId) {
  const res = await cache.match(manifestKey(areaId));
  return res ? res.json() : [];
}

/** Copy every file an area needs into Cache Storage for offline use. */
export async function saveOffline(areaId, name, onProgress = () => {}) {
  if (!('caches' in window)) {
    throw new Error('This browser cannot store data offline (needs HTTPS or localhost).');
  }
  const { urls } = await request(`api/offline/${areaId}.json`, { cache: 'no-store' });
  const cache = await caches.open(DATA_CACHE);
  let done = 0;
  let failed = 0;
  const queue = [...urls];
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) await cache.put(url, res);
        else failed++;
      } catch {
        failed++;
      }
      done++;
      onProgress(done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  // The (possibly large) file list lives in the cache, not in localStorage.
  await cache.put(manifestKey(areaId), new Response(JSON.stringify(urls)));
  prefs.markOffline(areaId, { name, savedAt: Date.now(), files: urls.length });
  return { total: urls.length, failed };
}

export async function removeOffline(areaId) {
  if (!prefs.offlineAreas()[areaId]) return;
  if ('caches' in window) {
    const cache = await caches.open(DATA_CACHE);
    const others = Object.keys(prefs.offlineAreas()).filter((id) => Number(id) !== Number(areaId));
    // Keep files another saved area still needs (library / index / shared photos).
    const keep = new Set((await Promise.all(others.map((id) => readManifest(cache, id)))).flat());
    const mine = await readManifest(cache, areaId);
    await Promise.all(mine.filter((u) => !keep.has(u)).map((u) => cache.delete(u)));
    await cache.delete(manifestKey(areaId));
  }
  prefs.unmarkOffline(areaId);
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}
