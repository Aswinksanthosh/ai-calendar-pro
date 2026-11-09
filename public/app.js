import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, collection, addDoc, deleteDoc, updateDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const fns = getFunctions(app, 'us-central1');
const call = (name, data) => httpsCallable(fns, name)(data).then((r) => r.data);

const $ = (id) => document.getElementById(id);
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
let user = null;
let unsubs = [];
let editingId = null;
let tasksCache = [];

// Build elements with textContent only, so user text can never inject HTML.
function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  kids.forEach((k) => n.append(k));
  return n;
}

// ---------- auth ----------
$('signIn').onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => alert(e.message));

onAuthStateChanged(auth, async (u) => {
  unsubs.forEach((f) => f());
  unsubs = [];
  user = u;
  $('signedOut').hidden = !!u;
  $('signedIn').hidden = !u;
  const box = $('auth');
  box.replaceChildren();
  if (!u) return;
  box.append(el('span', { className: 'muted', textContent: u.email + ' ' }), el('button', { textContent: 'Sign out', onclick: () => signOut(auth) }));
  await start();
});

// ---------- profile + connection ----------
async function start() {
  const ref = doc(db, 'users', user.uid);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!(await getDoc(ref)).exists()) await setDoc(ref, { timezone: tz });

  unsubs.push(onSnapshot(ref, (s) => {
    const d = s.data() || {};
    $('tz').value = d.timezone || tz;
    $('connStatus').textContent = d.connected ? '✅ Google Calendar is connected.' : 'Not connected yet.';
    $('connect').textContent = d.connected ? 'Reconnect' : 'Connect Google Calendar';
    $('runNow').hidden = !d.connected;
    const lr = d.lastRun;
    $('lastRun').textContent = lr ? `Last run created ${lr.created} event(s).` + (lr.skipped?.length ? ` Skipped: ${lr.skipped.map((x) => `${x.title} (${x.reason})`).join(', ')}.` : '') : '';
    if (d.connected) loadEvents();
  }));
  unsubs.push(onSnapshot(collection(db, 'users', user.uid, 'tasks'), (s) => {
    tasksCache = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.priority || 3) - (b.priority || 3));
    renderTasks();
  }));
  if (new URLSearchParams(location.search).get('connected')) history.replaceState({}, '', '/');
}

$('tz').onchange = () => updateDoc(doc(db, 'users', user.uid), { timezone: $('tz').value.trim() });
if (Intl.supportedValuesOf) {
  $('tzlist').append(...Intl.supportedValuesOf('timeZone').map((z) => el('option', { value: z })));
}

$('connect').onclick = async () => {
  try { location.href = (await call('connectUrl')).url; } catch (e) { alert(e.message); }
};
$('runNow').onclick = async (ev) => {
  ev.target.disabled = true;
  try { await call('scheduleNow'); await loadEvents(); } catch (e) { alert(e.message); }
  ev.target.disabled = false;
};
$('refresh').onclick = loadEvents;

// ---------- events ----------
async function loadEvents() {
  const ul = $('events');
  try {
    const { events } = await call('listUpcoming');
    ul.replaceChildren(...(events.length ? events.map((e) => {
      const when = e.allDay ? e.start + ' (all day)' : new Date(e.start).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      return el('li', {}, el('span', { textContent: e.title }), el('span', { className: 'muted', textContent: when }));
    }) : [el('li', { className: 'muted', textContent: 'No events in the next 7 days.' })]));
  } catch (e) {
    ul.replaceChildren(el('li', { className: 'muted', textContent: e.message }));
  }
}

// ---------- rules ----------
$('days').append(...DAYS.map((d) => el('label', {}, d.toUpperCase(), el('input', { name: 'day_' + d, placeholder: '7pm' }))));

function renderTasks() {
  const ul = $('tasks');
  if (!tasksCache.length) return ul.replaceChildren(el('li', { className: 'muted', textContent: 'No rules yet. Add your first one below.' }));
  ul.replaceChildren(...tasksCache.map((t) => el('li', {},
    el('span', {}, el('b', { textContent: t.name }), ' ',
      el('span', { className: 'tag', textContent: `${t.idealTime || 'auto'} · ${t.duration || '1h'} · P${t.priority || 3}${t.movable === false ? ' · fixed' : ''}` })),
    el('span', { className: 'row-actions' },
      el('button', { textContent: 'Edit', onclick: () => edit(t) }),
      el('button', { textContent: 'Delete', onclick: () => confirm(`Delete "${t.name}"?`) && deleteDoc(doc(db, 'users', user.uid, 'tasks', t.id)) })))));
}

function edit(t) {
  editingId = t.id;
  const f = $('taskForm');
  for (const k of ['name', 'idealTime', 'duration', 'priority', 'bufferBefore', 'bufferAfter', 'windowStart', 'windowEnd', 'avoid']) f.elements[k].value = t[k] ?? '';
  f.elements.movable.checked = t.movable !== false;
  f.elements.afterTask.value = t.after?.[0]?.task || '';
  f.elements.afterGap.value = t.after?.[0]?.gap ?? 0;
  f.elements.beforeTask.value = t.before?.[0]?.task || '';
  f.elements.beforeGap.value = t.before?.[0]?.gap ?? 0;
  DAYS.forEach((d) => (f.elements['day_' + d].value = t.dayTimes?.[d] || ''));
  $('formTitle').textContent = 'Edit rule';
  $('cancelEdit').hidden = false;
  f.scrollIntoView({ behavior: 'smooth' });
}

function resetForm() {
  editingId = null;
  $('taskForm').reset();
  $('formTitle').textContent = 'Add a rule';
  $('cancelEdit').hidden = true;
  $('formError').textContent = '';
}
$('cancelEdit').onclick = resetForm;

$('taskForm').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target.elements;
  const v = (k) => f[k].value.trim();
  const dayTimes = {};
  DAYS.forEach((d) => { if (v('day_' + d)) dayTimes[d] = v('day_' + d); });
  const data = {
    name: v('name'), idealTime: v('idealTime'), duration: v('duration') || '1h',
    priority: Number(v('priority')) || 3, movable: f.movable.checked,
    bufferBefore: Number(v('bufferBefore')) || 0, bufferAfter: Number(v('bufferAfter')) || 0,
    windowStart: v('windowStart'), windowEnd: v('windowEnd'), avoid: v('avoid'), dayTimes,
    after: v('afterTask') ? [{ task: v('afterTask'), gap: Number(v('afterGap')) || 0 }] : [],
    before: v('beforeTask') ? [{ task: v('beforeTask'), gap: Number(v('beforeGap')) || 0 }] : [],
  };
  try {
    const col = collection(db, 'users', user.uid, 'tasks');
    if (editingId) await setDoc(doc(col, editingId), data); else await addDoc(col, data);
    resetForm();
  } catch (e) {
    $('formError').textContent = e.message;
  }
};
