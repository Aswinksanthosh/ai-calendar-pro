import { h, $, store } from './dom.js';
import * as D from './dates.js';
import { createApi, AuthError } from './api.js';
import { onUser, signIn, signOutUser, getToken, clearToken } from './auth.js';
import { renderMonth, renderGrid, HOUR } from './views.js';
import { openEventDialog } from './dialog.js';

const api = createApi(getToken);
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const WEEK_START = 0; // 0 = Sunday, 1 = Monday (a settings page can change this later)
const narrow = () => matchMedia('(max-width: 640px)').matches;

const state = { view: store.get('view', 'week'), date: new Date(), calendars: [], visible: new Set(), events: [], seq: 0 };
const cache = new Map();
let booted = false;
let resetScroll = true;
let lastFetch = 0;

// ---------- helpers ----------
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.id);
  toast.id = setTimeout(() => { t.hidden = true; }, 4000);
}

function showLogin(note = '') {
  booted = false;
  $('app').hidden = true;
  $('login').hidden = false;
  $('loginNote').textContent = note;
}

function handleError(err) {
  if (err instanceof AuthError) { clearToken(); showLogin(err.message); } else toast(err.message || 'Something went wrong.');
}

const isWritable = (c) => c.accessRole === 'owner' || c.accessRole === 'writer';
const calById = (id) => state.calendars.find((c) => c.id === id);

// ---------- what is on screen ----------
function visibleDays() {
  if (state.view === 'day') return [state.date];
  if (state.view === 'week' && narrow()) return [0, 1, 2].map((i) => D.addDays(state.date, i));
  const s = D.startOfWeek(state.date, WEEK_START);
  return Array.from({ length: 7 }, (_, i) => D.addDays(s, i));
}

function range() {
  if (state.view === 'month') {
    const w = D.monthGrid(state.date, WEEK_START);
    return [w[0][0], D.addDays(w[w.length - 1][6], 1)];
  }
  const d = visibleDays();
  return [d[0], D.addDays(d[d.length - 1], 1)];
}

function titleText() {
  const o = { month: 'short', day: 'numeric' };
  if (state.view === 'month') return state.date.toLocaleDateString([], { month: 'long', year: 'numeric' });
  if (state.view === 'day') return state.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const d = visibleDays();
  const a = d[0]; const b = d[d.length - 1];
  const left = a.toLocaleDateString([], o);
  const right = a.getMonth() === b.getMonth() ? String(b.getDate()) : b.toLocaleDateString([], o);
  return `${left} – ${right}, ${b.getFullYear()}`;
}

function step(dir) {
  if (state.view === 'month') state.date = D.addMonths(state.date, dir);
  else if (state.view === 'day') state.date = D.addDays(state.date, dir);
  else state.date = D.addDays(state.date, dir * (narrow() ? 3 : 7));
  refresh();
}

function updateHeader() {
  $('title').textContent = titleText();
  $('weekBtn').textContent = narrow() ? '3 days' : 'Week';
  for (const b of $('views').children) b.classList.toggle('on', b.dataset.view === state.view);
}

// ---------- loading + drawing ----------
async function fetchCalendar(cal, start, end) {
  const key = `${cal.id}|${start.getTime()}|${end.getTime()}`;
  if (!cache.has(key)) cache.set(key, api.events(cal.id, start, end).catch((e) => { cache.delete(key); throw e; }));
  return cache.get(key);
}

async function load() {
  const mine = ++state.seq;
  const [start, end] = range();
  $('busy').hidden = false;
  try {
    const cals = [...state.visible].map(calById).filter(Boolean);
    const lists = await Promise.all(cals.map(async (c) => (await fetchCalendar(c, start, end)).map((e) => D.normalizeEvent(e, c))));
    if (mine !== state.seq) return;
    state.events = lists.flat();
    lastFetch = Date.now();
    render();
  } catch (err) {
    if (mine === state.seq) handleError(err);
  } finally {
    if (mine === state.seq) $('busy').hidden = true;
  }
}

function refresh() { updateHeader(); resetScroll = true; load(); }

function render() {
  updateHeader();
  const root = $('main');
  const today = new Date();
  const common = { events: state.events, today, onEvent: editEvent };
  const prevScroll = root.querySelector('.tg-body')?.scrollTop;
  if (state.view === 'month') {
    root.className = 'month';
    renderMonth(root, { ...common, date: state.date, weekStart: WEEK_START, onDay: (d) => { state.date = d; state.view = 'day'; store.set('view', 'day'); refresh(); } });
    return;
  }
  root.className = 'tg';
  const days = visibleDays();
  const body = renderGrid(root, { ...common, days, onSlot: (d, min) => newEvent(d, min) });
  if (resetScroll || prevScroll == null) {
    const hasToday = days.some((d) => D.sameDay(d, today));
    body.scrollTop = (hasToday ? Math.max(0, today.getHours() - 1) : 7) * HOUR;
    resetScroll = false;
  } else body.scrollTop = prevScroll;
}

// ---------- create / edit ----------
function newEvent(day, minutes) {
  const writable = state.calendars.filter(isWritable);
  if (!writable.length) return toast('You have no calendar you can add events to.');
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
  const end = new Date(start.getTime() + 3600000);
  const form = {
    title: '', allDay: false, startDate: D.ymd(start), startTime: D.hm(start), endDate: D.ymd(end), endTime: D.hm(end),
    description: '', location: '', recurrence: 'none', reminder: 'default',
  };
  const primary = writable.find((c) => c.primary) || writable[0];
  openEventDialog({
    isNew: true, form, calendars: writable, calId: primary.id, recurring: false,
    onSave: async (f, _scope, calId) => { await api.insert(calId, D.buildEventBody(f, tz)); afterChange(); },
  });
}

const timeMs = (t) => (t.dateTime ? Date.parse(t.dateTime) : D.parseYmd(t.date).getTime());

function editEvent(ev) {
  const cal = calById(ev.calId);
  const recurring = !!ev.raw.recurringEventId;
  const masterId = ev.raw.recurringEventId;
  openEventDialog({
    isNew: false, form: D.eventToForm(ev), calendars: [{ id: ev.calId, summary: cal ? cal.summary : ev.calId }], calId: ev.calId,
    recurring, readOnly: !cal || !isWritable(cal),
    onSave: async (f, scope) => {
      const body = D.buildEventBody(f, tz, { editing: true });
      if (!recurring) await api.patch(ev.calId, ev.id, body);
      else if (scope === 'this') { delete body.recurrence; await api.patch(ev.calId, ev.id, body); }
      else {
        if (f.allDay !== ev.allDay) throw new Error('To switch a repeating event between all-day and timed, edit "This event" only.');
        const master = await api.get(ev.calId, masterId);
        const patch = { summary: body.summary, description: body.description, location: body.location, reminders: body.reminders };
        const dS = timeMs(body.start) - ev.start.getTime();
        const dE = timeMs(body.end) - ev.end.getTime();
        if (dS || dE) Object.assign(patch, D.shiftBody(master, dS, dE));
        await api.patch(ev.calId, masterId, patch);
      }
      afterChange();
    },
    onDelete: async (scope) => { await api.remove(ev.calId, scope === 'all' && recurring ? masterId : ev.id); afterChange(); },
  });
}

function afterChange() { cache.clear(); load(); }

// ---------- calendars drawer ----------
function buildDrawer() {
  $('calList').replaceChildren(...state.calendars.map((c) => h('li', {}, h('label', { style: { '--c': c.backgroundColor } },
    h('input', {
      type: 'checkbox', checked: state.visible.has(c.id),
      onchange: (e) => {
        e.target.checked ? state.visible.add(c.id) : state.visible.delete(c.id);
        store.set('visible', [...state.visible]);
        load();
      },
    }), c.summaryOverride || c.summary))));
}
const drawer = (open) => { $('drawer').classList.toggle('open', open); $('scrim').hidden = !open; };

// ---------- start ----------
async function boot() {
  if (booted) return;
  booted = true;
  $('login').hidden = true;
  $('app').hidden = false;
  try {
    state.calendars = await api.calendars();
    const saved = store.get('visible', null);
    const ids = saved ? saved.filter((id) => calById(id)) : [];
    state.visible = new Set(ids.length ? ids : state.calendars.filter((c) => c.selected).map((c) => c.id));
    if (!state.visible.size && state.calendars[0]) state.visible.add((state.calendars.find((c) => c.primary) || state.calendars[0]).id);
    buildDrawer();
    updateHeader();
    await load();
  } catch (err) { handleError(err); }
}

$('signIn').onclick = async () => {
  try { await signIn(); await boot(); } catch (e) { if (e.code !== 'auth/popup-closed-by-user') toast(e.message); }
};
$('signOut').onclick = async () => { drawer(false); await signOutUser(); showLogin(); };
$('menu').onclick = () => drawer(true);
$('scrim').onclick = () => drawer(false);
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);
$('today').onclick = () => { state.date = new Date(); refresh(); };
$('fab').onclick = () => {
  const now = new Date();
  const sameDayNow = D.sameDay(state.date, now);
  newEvent(state.date, sameDayNow ? Math.min(1380, (now.getHours() + 1) * 60) : 9 * 60);
};
for (const b of $('views').children) {
  b.onclick = () => { state.view = b.dataset.view; store.set('view', state.view); refresh(); };
}

// Swipe left/right to change period (phone).
let touch = null;
$('main').addEventListener('touchstart', (e) => { touch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
$('main').addEventListener('touchend', (e) => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x;
  const dy = e.changedTouches[0].clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 70 && Math.abs(dy) < 40) step(dx < 0 ? 1 : -1);
});

// Every minute: move the "now" line. Every 5 minutes: pick up changes made elsewhere.
setInterval(() => {
  if ($('app').hidden || $('evDialog').open) return;
  if (Date.now() - lastFetch > 5 * 60 * 1000) { cache.clear(); load(); } else render();
}, 60 * 1000);
matchMedia('(max-width: 640px)').addEventListener('change', () => { if (booted) refresh(); });

onUser((u) => {
  if (!u) return showLogin();
  $('who').textContent = u.email || '';
  if (getToken()) boot();
  else showLogin(`Welcome back, ${u.displayName || u.email}. Please sign in again to open your calendar.`);
});
