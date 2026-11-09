'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTask } = require('../lib/config');
const { zonedToUtcMs } = require('../lib/time');
const { scheduleUser, applyAction } = require('../lib/run');

const TZ = 'America/Toronto';
const DATE = '2026-03-10';

function fakeCalendar(initial) {
  const events = [...initial];
  let n = 0;
  return {
    events,
    cal: {
      events: {
        list: async () => ({ data: { items: events } }),
        insert: async ({ requestBody }) => {
          const e = { id: `new${++n}`, ...requestBody };
          events.push(e);
          return { data: e };
        },
        patch: async ({ eventId, requestBody }) => {
          Object.assign(events.find((e) => e.id === eventId), requestBody);
          return { data: {} };
        },
        get: async ({ eventId }) => ({ data: events.find((e) => e.id === eventId) }),
      },
    },
  };
}

const rule = (raw) => normalizeTask(raw).task;
const allDay = (id, summary) => ({ id, summary, start: { date: DATE }, end: { date: '2026-03-11' } });
const iso = (min) => new Date(zonedToUtcMs(DATE, min, TZ)).toISOString();
const base = (cal, taskMap) => ({
  cal, tz: TZ, taskMap, appUrl: 'https://app.test', linkSecret: 's', uid: 'u1',
  nowMs: zonedToUtcMs(DATE, 6 * 60, TZ), daysAhead: 1,
});

test('creates a timed event for an all-day task, with action links', async () => {
  const gym = rule({ name: 'Gym', idealTime: '3pm', duration: '1h' });
  const { cal, events } = fakeCalendar([allDay('a1', 'Gym')]);
  const out = await scheduleUser(base(cal, { gym }));
  assert.equal(out.created.length, 1);
  const made = events.find((e) => e.id === 'new1');
  assert.equal(made.start.dateTime, iso(15 * 60));
  assert.match(made.description, /action\?/);
  assert.equal(made.extendedProperties.private.aiCalPro, '1');
});

test('does not create duplicates on the next run', async () => {
  const gym = rule({ name: 'Gym', idealTime: '3pm', duration: '1h' });
  const { cal, events } = fakeCalendar([allDay('a1', 'Gym')]);
  await scheduleUser(base(cal, { gym }));
  const again = await scheduleUser(base(cal, { gym }));
  assert.equal(again.created.length, 0);
  assert.equal(events.length, 2);
});

test('skips finished tasks and tasks without a rule', async () => {
  const gym = rule({ name: 'Gym', idealTime: '3pm' });
  const { cal } = fakeCalendar([allDay('a1', '✅ Gym'), allDay('a2', 'Dentist')]);
  const out = await scheduleUser(base(cal, { gym }));
  assert.equal(out.created.length, 0);
  assert.equal(out.skipped[0].reason, 'no rule for this task');
});

test('FINISH, POSTPONE and COMPRESS change the event', async () => {
  const ev = { id: 'e1', summary: 'Gym', start: { dateTime: iso(900) }, end: { dateTime: iso(960) } };
  const { cal } = fakeCalendar([ev]);
  await applyAction(cal, { eventId: 'e1', action: 'postpone', minutes: 30 });
  assert.equal(ev.start.dateTime, iso(930));
  await applyAction(cal, { eventId: 'e1', action: 'compress', minutes: 15 });
  assert.equal(ev.end.dateTime, iso(975));
  await applyAction(cal, { eventId: 'e1', action: 'finish' });
  assert.equal(ev.summary, '✅ Gym');
  await applyAction(cal, { eventId: 'e1', action: 'finish' });
  assert.equal(ev.summary, '✅ Gym'); // not doubled
});
