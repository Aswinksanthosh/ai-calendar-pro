process.env.TZ = 'America/Toronto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../public/dates.js';

const cal = { id: 'c1', backgroundColor: '#f00', foregroundColor: '#fff' };
const timed = (id, s, e) => D.normalizeEvent({ id, summary: id, start: { dateTime: s }, end: { dateTime: e } }, cal);
const allDay = (id, s, e) => D.normalizeEvent({ id, summary: id, start: { date: s }, end: { date: e } }, cal);

test('addMonths clamps to the end of shorter months', () => {
  assert.equal(D.ymd(D.addMonths(new Date(2026, 0, 31), 1)), '2026-02-28');
  assert.equal(D.ymd(D.addMonths(new Date(2026, 11, 15), 1)), '2027-01-15');
  assert.equal(D.ymd(D.addMonths(new Date(2026, 2, 31), -1)), '2026-02-28');
});

test('startOfWeek respects the first day of the week', () => {
  const wed = new Date(2026, 2, 11); // Wed 11 Mar 2026
  assert.equal(D.ymd(D.startOfWeek(wed, 0)), '2026-03-08'); // Sunday
  assert.equal(D.ymd(D.startOfWeek(wed, 1)), '2026-03-09'); // Monday
});

test('monthGrid covers the month in whole weeks', () => {
  const g = D.monthGrid(new Date(2026, 2, 10), 0); // March 2026
  assert.ok(g.length === 5 || g.length === 6);
  assert.equal(D.ymd(g[0][0]), '2026-03-01');
  assert.ok(g.flat().some((d) => D.ymd(d) === '2026-03-31'));
  assert.ok(g.every((w) => w.length === 7));
  const feb = D.monthGrid(new Date(2026, 1, 10), 0); // Feb 2026 starts on Sunday, 28 days
  assert.equal(feb.length, 4);
  assert.equal(D.monthGrid(new Date(2026, 7, 10), 0).length, 6); // Aug 2026 needs six rows
});

test('all-day end date is exclusive; timed events can cross midnight', () => {
  const trip = allDay('trip', '2026-03-10', '2026-03-12'); // 10th and 11th
  assert.equal(D.eventsOnDay([trip], new Date(2026, 2, 11)).length, 1);
  assert.equal(D.eventsOnDay([trip], new Date(2026, 2, 12)).length, 0);
  const night = timed('night', '2026-03-10T23:00:00-04:00', '2026-03-11T01:00:00-04:00');
  assert.equal(D.eventsOnDay([night], new Date(2026, 2, 10)).length, 1);
  assert.equal(D.eventsOnDay([night], new Date(2026, 2, 11)).length, 1);
  assert.equal(D.eventsOnDay([night], new Date(2026, 2, 12)).length, 0);
});

test('all-day events sort before timed ones', () => {
  const a = timed('a', '2026-03-10T09:00:00-04:00', '2026-03-10T10:00:00-04:00');
  const b = allDay('b', '2026-03-10', '2026-03-11');
  assert.deepEqual(D.eventsOnDay([a, b], new Date(2026, 2, 10)).map((e) => e.id), ['b', 'a']);
});

test('layoutDay puts overlapping events side by side and resets after a gap', () => {
  const day = new Date(2026, 2, 10);
  const e1 = timed('e1', '2026-03-10T09:00:00-04:00', '2026-03-10T11:00:00-04:00');
  const e2 = timed('e2', '2026-03-10T10:00:00-04:00', '2026-03-10T12:00:00-04:00');
  const e3 = timed('e3', '2026-03-10T10:30:00-04:00', '2026-03-10T11:00:00-04:00');
  const e4 = timed('e4', '2026-03-10T15:00:00-04:00', '2026-03-10T16:00:00-04:00');
  const out = Object.fromEntries(D.layoutDay([e4, e3, e2, e1], day).map((x) => [x.event.id, x]));
  assert.equal(out.e1.cols, 3);
  assert.deepEqual([out.e1.col, out.e2.col, out.e3.col].sort(), [0, 1, 2]);
  assert.equal(out.e4.cols, 1);
  assert.equal(out.e4.col, 0);
  assert.equal(out.e1.start, 540);
  assert.equal(out.e1.end, 660);
});

test('layoutDay gives tiny events a visible height and clips to the day', () => {
  const tiny = timed('t', '2026-03-10T09:00:00-04:00', '2026-03-10T09:05:00-04:00');
  assert.equal(D.layoutDay([tiny], new Date(2026, 2, 10))[0].end, 570);
  const night = timed('n', '2026-03-10T23:00:00-04:00', '2026-03-11T02:00:00-04:00');
  assert.equal(D.layoutDay([night], new Date(2026, 2, 10))[0].end, 1440);
  assert.equal(D.layoutDay([night], new Date(2026, 2, 11))[0].start, 0);
});

test('timed event -> form -> body round trip', () => {
  const ev = timed('x', '2026-03-10T15:00:00-04:00', '2026-03-10T16:30:00-04:00');
  ev.raw.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] };
  const f = D.eventToForm(ev);
  assert.deepEqual([f.startDate, f.startTime, f.endDate, f.endTime, f.reminder], ['2026-03-10', '15:00', '2026-03-10', '16:30', '30']);
  const body = D.buildEventBody({ ...f, title: ' Gym ' }, 'America/Toronto');
  assert.equal(body.summary, 'Gym');
  assert.equal(body.start.dateTime, '2026-03-10T19:00:00.000Z');
  assert.equal(body.end.dateTime, '2026-03-10T20:30:00.000Z');
  assert.deepEqual(body.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] });
  assert.equal(body.recurrence, undefined);
});

test('all-day form shows an inclusive end date and sends an exclusive one', () => {
  const ev = allDay('trip', '2026-03-10', '2026-03-12');
  const f = D.eventToForm(ev);
  assert.equal(f.endDate, '2026-03-11');
  const body = D.buildEventBody(f, 'America/Toronto');
  assert.deepEqual(body.start, { date: '2026-03-10' });
  assert.deepEqual(body.end, { date: '2026-03-12' });
});

test('editing clears the unused start/end field so all-day <-> timed switches work', () => {
  const f = { title: 't', allDay: true, startDate: '2026-03-10', endDate: '2026-03-10', startTime: '09:00', endTime: '10:00', recurrence: 'none', reminder: 'default' };
  const b = D.buildEventBody(f, 'UTC', { editing: true });
  assert.deepEqual(b.start, { date: '2026-03-10', dateTime: null, timeZone: null });
  const t = D.buildEventBody({ ...f, allDay: false }, 'UTC', { editing: true });
  assert.equal(t.start.date, null);
  assert.ok(t.start.dateTime);
});

test('recurrence mapping keeps complex rules untouched', () => {
  assert.equal(D.recurrenceKind(undefined), 'none');
  assert.equal(D.recurrenceKind(['RRULE:FREQ=WEEKLY']), 'weekly');
  assert.equal(D.recurrenceKind(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE']), 'keep');
  const base = { title: 't', allDay: false, startDate: '2026-03-10', startTime: '09:00', endDate: '2026-03-10', endTime: '10:00', reminder: 'default' };
  assert.deepEqual(D.buildEventBody({ ...base, recurrence: 'weekly' }, 'UTC').recurrence, ['RRULE:FREQ=WEEKLY']);
  assert.equal(D.buildEventBody({ ...base, recurrence: 'keep' }, 'UTC', { editing: true }).recurrence, undefined);
  assert.deepEqual(D.buildEventBody({ ...base, recurrence: 'none' }, 'UTC', { editing: true }).recurrence, []);
  assert.equal(D.buildEventBody({ ...base, recurrence: 'none' }, 'UTC').recurrence, undefined);
});

test('a recurring instance is edited with recurrence kept', () => {
  const ev = timed('inst', '2026-03-10T09:00:00-04:00', '2026-03-10T10:00:00-04:00');
  ev.raw.recurringEventId = 'master';
  assert.equal(D.eventToForm(ev).recurrence, 'keep');
});

test('validateForm', () => {
  const ok = { allDay: false, startDate: '2026-03-10', startTime: '09:00', endDate: '2026-03-10', endTime: '10:00' };
  assert.equal(D.validateForm(ok), '');
  assert.match(D.validateForm({ ...ok, endTime: '08:00' }), /end after/);
  assert.match(D.validateForm({ allDay: true, startDate: '2026-03-10', endDate: '2026-03-09' }), /before/);
  assert.equal(D.validateForm({ allDay: true, startDate: '2026-03-10', endDate: '2026-03-10' }), '');
});

test('shiftBody moves a series by the same amount, timed and all-day', () => {
  const m = { start: { dateTime: '2026-03-02T14:00:00.000Z', timeZone: 'America/Toronto' }, end: { dateTime: '2026-03-02T15:00:00.000Z', timeZone: 'America/Toronto' } };
  const s = D.shiftBody(m, 30 * 60000, 30 * 60000);
  assert.equal(s.start.dateTime, '2026-03-02T14:30:00.000Z');
  assert.equal(s.end.timeZone, 'America/Toronto');
  const a = D.shiftBody({ start: { date: '2026-03-02' }, end: { date: '2026-03-03' } }, 86400000, 86400000);
  assert.deepEqual(a, { start: { date: '2026-03-03' }, end: { date: '2026-03-04' } });
});
