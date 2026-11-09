'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/time');
const { normalizeTask, cleanTaskName } = require('../lib/config');
const { planDay } = require('../lib/scheduler');
const L = require('../lib/links');

const TZ = 'America/Toronto';
const DATE = '2026-03-10'; // after DST change, UTC-4
const at = (min) => T.zonedToUtcMs(DATE, min, TZ);
const mk = (raw) => {
  const r = normalizeTask(raw);
  assert.ok(r.ok, JSON.stringify(r.errors));
  return r.task;
};
const mapOf = (...tasks) => Object.fromEntries(tasks.map((t) => [t.key, t]));

test('parseClock / parseDuration', () => {
  assert.equal(T.parseClock('7pm'), 19 * 60);
  assert.equal(T.parseClock('12am'), 0);
  assert.equal(T.parseClock('1:30pm'), 13 * 60 + 30);
  assert.equal(T.parseClock('25:00'), null);
  assert.equal(T.parseDuration('1h'), 60);
  assert.equal(T.parseDuration('1:30h'), 90);
  assert.equal(T.parseDuration('1h30m'), 90);
  assert.equal(T.parseDuration('45m'), 45);
  assert.equal(T.parseDuration('abc'), null);
});

test('timezone conversion round-trips, including DST', () => {
  const ms = T.zonedToUtcMs('2026-03-10', 9 * 60, TZ);
  assert.equal(new Date(ms).toISOString(), '2026-03-10T13:00:00.000Z'); // EDT
  assert.deepEqual(T.utcMsToZoned(ms, TZ), { date: '2026-03-10', minutes: 540 });
  const winter = T.zonedToUtcMs('2026-01-10', 9 * 60, TZ);
  assert.equal(new Date(winter).toISOString(), '2026-01-10T14:00:00.000Z'); // EST
  assert.equal(T.weekdayKey('2026-03-10'), 'tue');
});

test('cleanTaskName strips flags and prefixes', () => {
  assert.equal(cleanTaskName('✅ Gym '), 'gym');
  assert.equal(cleanTaskName('🏋️ GYM'), 'gym');
});

test('normalizeTask reports bad input', () => {
  const r = normalizeTask({ name: 'x', duration: 'nope', idealTime: '99pm' });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
});

test('places a task at its ideal time when free', () => {
  const gym = mk({ name: 'Gym', idealTime: '3pm', duration: '1h' });
  const [r] = planDay({ date: DATE, tz: TZ, requested: [gym], busy: [], taskMap: mapOf(gym) });
  assert.equal(r.status, 'ideal');
  assert.equal(r.startMs, at(15 * 60));
});

test('moves in 15-minute steps around a conflict', () => {
  const gym = mk({ name: 'Gym', idealTime: '3pm', duration: '1h' });
  const busy = [{ key: 'meeting', startMs: at(15 * 60), endMs: at(16 * 60) }];
  const [r] = planDay({ date: DATE, tz: TZ, requested: [gym], busy, taskMap: mapOf(gym) });
  assert.equal(r.status, 'moved');
  assert.equal(r.startMs, at(16 * 60)); // forward is tried before backward
});

test('respects buffers', () => {
  const eat = mk({ name: 'Eat', idealTime: '12:30pm', duration: '30m', bufferBefore: 15 });
  const busy = [{ key: 'call', startMs: at(12 * 60), endMs: at(12 * 60 + 30) }];
  const [r] = planDay({ date: DATE, tz: TZ, requested: [eat], busy, taskMap: mapOf(eat) });
  assert.equal(r.startMs, at(12 * 60 + 45)); // 15 min gap after the call
});

test('"Gym after Work" dependency', () => {
  const work = mk({ name: 'Work', idealTime: '9am', duration: '4h', movable: false });
  const gym = mk({ name: 'Gym', idealTime: '10am', duration: '1h', after: [{ task: 'work', gap: 30 }] });
  const res = planDay({ date: DATE, tz: TZ, requested: [gym, work], busy: [], taskMap: mapOf(work, gym) });
  const g = res.find((x) => x.task.key === 'gym');
  assert.equal(g.startMs, at(13 * 60 + 30)); // work ends 13:00 + 30 min gap
});

test('avoid rule keeps distance from another event', () => {
  const gym = mk({ name: 'Gym', idealTime: '8am', duration: '1h', avoid: 'sleep:240' });
  const busy = [{ key: 'sleep', startMs: at(-60), endMs: at(7 * 60) }]; // slept until 7am
  const [r] = planDay({ date: DATE, tz: TZ, requested: [gym], busy, taskMap: mapOf(gym) });
  assert.equal(r.startMs, at(11 * 60)); // 4h after sleep ends
});

test('fixed (non-movable) task is placed at ideal time even with conflicts', () => {
  const sleep = mk({ name: 'Sleep', idealTime: '10:30pm', duration: '8h', movable: false });
  const [r] = planDay({ date: DATE, tz: TZ, requested: [sleep], busy: [], taskMap: mapOf(sleep) });
  assert.equal(r.status, 'fixed');
  assert.equal(r.endMs - r.startMs, 8 * 60 * 60000);
});

test('reports no-slot instead of looping forever', () => {
  const big = mk({ name: 'Big', idealTime: '9am', duration: '3h', windowStart: '9am', windowEnd: '11am' });
  const [r] = planDay({ date: DATE, tz: TZ, requested: [big], busy: [], taskMap: mapOf(big) });
  assert.equal(r.status, 'no-slot');
});

test('never schedules a movable task in the past', () => {
  const gym = mk({ name: 'Gym', idealTime: '8am', duration: '1h' });
  const nowMs = at(10 * 60 + 5);
  const [r] = planDay({ date: DATE, tz: TZ, requested: [gym], busy: [], taskMap: mapOf(gym), nowMs });
  assert.equal(r.startMs, at(10 * 60 + 15));
});

test('action links verify, expire and detect tampering', () => {
  const link = L.makeActionLink('https://app.test', 's3cret', { uid: 'u1', eventId: 'e1', action: 'postpone', minutes: 30 }, 1000);
  const q = Object.fromEntries(new URL(link).searchParams);
  assert.deepEqual(L.verifyAction('s3cret', q, 2000), { uid: 'u1', eventId: 'e1', action: 'postpone', minutes: 30 });
  assert.equal(L.verifyAction('wrong', q, 2000), null);
  assert.equal(L.verifyAction('s3cret', { ...q, m: '9999' }, 2000), null);
  assert.equal(L.verifyAction('s3cret', q, 1000 + 15 * 24 * 3600 * 1000), null);
  const st = L.makeState('k', 'u1', 0);
  assert.equal(L.verifyState('k', st, 1000), 'u1');
  assert.equal(L.verifyState('k', st, 11 * 60 * 1000), null);
});
