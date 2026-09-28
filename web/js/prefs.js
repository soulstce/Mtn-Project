// Per-device state: settings, ticks / to-dos and which areas are saved offline.
// Everything lives in localStorage and is wrapped so a blocked storage never
// breaks the app.

const KEY = 'crag-offline:v1';

const defaults = {
  rockSystem: 'yds',
  boulderSystem: 'yds',
  theme: 'auto',
  ticks: {},     // routeId -> {date, style, notes, name, grade, grade_key, area_name, area_id}
  todos: {},     // routeId -> {added, name, grade, grade_key, area_name, area_id}
  offline: {},   // areaId  -> {name, savedAt, files}
  listSort: 'wall',
};

function load() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

let state = load();
const listeners = new Set();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode) – keep in memory */
  }
  listeners.forEach((fn) => fn(state));
}

function routeSnapshot(route) {
  return {
    name: route.name,
    grade: route.grade,
    grades: route.grades || {},
    grade_key: route.grade_key,
    types: route.types || [],
    area_id: route.area_id,
    area_name: route.area_name,
  };
}

export const prefs = {
  get: (key) => state[key],
  set(key, value) {
    state[key] = value;
    save();
  },
  onChange: (fn) => listeners.add(fn),

  tick: (id) => state.ticks[id],
  todo: (id) => state.todos[id],
  toggleTick(route, extra = {}) {
    if (state.ticks[route.id] && !extra.keep) {
      delete state.ticks[route.id];
    } else {
      state.ticks[route.id] = {
        ...routeSnapshot(route),
        date: new Date().toISOString().slice(0, 10),
        style: '',
        notes: '',
        ...state.ticks[route.id],
        ...extra,
      };
      delete state.todos[route.id];
    }
    save();
    return !!state.ticks[route.id];
  },
  updateTick(id, fields) {
    if (!state.ticks[id]) return;
    state.ticks[id] = { ...state.ticks[id], ...fields };
    save();
  },
  toggleTodo(route) {
    if (state.todos[route.id]) delete state.todos[route.id];
    else state.todos[route.id] = { ...routeSnapshot(route), added: Date.now() };
    save();
    return !!state.todos[route.id];
  },

  offlineAreas: () => state.offline,
  markOffline(id, info) {
    state.offline[id] = info;
    save();
  },
  unmarkOffline(id) {
    delete state.offline[id];
    save();
  },

  applyTheme() {
    const theme = state.theme;
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = theme;
  },
};
