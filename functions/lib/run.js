'use strict';
// One scheduling pass for one user: read calendar + rules, plan, create timed events.

const { MIN, zonedToUtcMs, utcMsToZoned, addDays } = require('./time');
const { cleanTaskName, normalizeTask } = require('./config');
const { planDay } = require('./scheduler');
const { listEvents } = require('./gcal');
const { buildDescription } = require('./description');
const { makeActionLink } = require('./links');

const DEFAULT_DAYS_AHEAD = 7;

function loadTasks(snap) {
  const taskMap = {};
  const problems = [];
  snap.forEach((doc) => {
    const r = normalizeTask(doc.data());
    if (r.ok) taskMap[r.task.key] = r.task;
    else problems.push({ id: doc.id, errors: r.errors });
  });
  return { taskMap, problems };
}

/**
 * @param {object} deps { cal, tz, taskMap, appUrl, linkSecret, uid, nowMs, daysAhead }
 * @returns {Promise<{created:object[], skipped:object[]}>}
 */
async function scheduleUser({ cal, tz, taskMap, appUrl, linkSecret, uid, nowMs = Date.now(), daysAhead = DEFAULT_DAYS_AHEAD }) {
  const today = utcMsToZoned(nowMs, tz).date;
  const lastDay = addDays(today, daysAhead - 1);
  const rangeStart = zonedToUtcMs(addDays(today, -1), 0, tz);
  const rangeEnd = zonedToUtcMs(addDays(lastDay, 2), 0, tz);
  const events = await listEvents(cal, rangeStart, rangeEnd);

  const allDay = events.filter((e) => e.start && e.start.date);
  const timed = events
    .filter((e) => e.start && e.start.dateTime)
    .map((e) => ({
      id: e.id,
      key: cleanTaskName(e.summary),
      startMs: Date.parse(e.start.dateTime),
      endMs: Date.parse(e.end.dateTime),
    }));

  const created = [];
  const skipped = [];

  for (let date = today; date <= lastDay; date = addDays(date, 1)) {
    // All-day events covering this date whose title matches a rule.
    const wantedToday = allDay.filter((e) => e.start.date <= date && date < e.end.date);
    const doneKeys = new Set(
      timed.filter((t) => utcMsToZoned(t.startMs, tz).date === date).map((t) => t.key),
    );

    const requested = [];
    const seen = new Set();
    for (const e of wantedToday) {
      const key = cleanTaskName(e.summary);
      if (/^\s*✅/.test(e.summary || '')) continue; // already finished
      const task = taskMap[key];
      if (!task) {
        skipped.push({ date, title: e.summary, reason: 'no rule for this task' });
        continue;
      }
      if (doneKeys.has(key) || seen.has(key)) continue; // duplicate prevention
      seen.add(key);
      requested.push(task);
    }
    if (!requested.length) continue;

    const results = planDay({ date, tz, requested, busy: timed, taskMap, nowMs });
    for (const r of results) {
      if (r.startMs == null) {
        skipped.push({ date, title: r.task.name, reason: 'no free slot' });
        continue;
      }
      if (r.endMs < nowMs) {
        skipped.push({ date, title: r.task.name, reason: 'time already passed' });
        continue;
      }
      const res = await cal.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: r.task.name,
          start: { dateTime: new Date(r.startMs).toISOString(), timeZone: tz },
          end: { dateTime: new Date(r.endMs).toISOString(), timeZone: tz },
          extendedProperties: { private: { aiCalPro: '1', taskKey: r.task.key, date } },
        },
      });
      const id = res.data.id;
      const link = (action, minutes) => makeActionLink(appUrl, linkSecret, { uid, eventId: id, action, minutes });
      await cal.events.patch({
        calendarId: 'primary',
        eventId: id,
        requestBody: {
          description: buildDescription(
            r.task,
            { finish: link('finish', 0), postpone: link('postpone', 30), compress: link('compress', 15) },
            r.status,
          ),
        },
      });
      timed.push({ id, key: r.task.key, startMs: r.startMs, endMs: r.endMs });
      created.push({ date, title: r.task.name, startMs: r.startMs, endMs: r.endMs, status: r.status });
    }
  }
  return { created, skipped };
}

/** Apply FINISH / POSTPONE / COMPRESS to one event. Returns a short message. */
async function applyAction(cal, { eventId, action, minutes }) {
  const { data: ev } = await cal.events.get({ calendarId: 'primary', eventId });
  if (!ev.start || !ev.start.dateTime) throw new Error('Only timed events can be changed');
  const start = Date.parse(ev.start.dateTime);
  const end = Date.parse(ev.end.dateTime);

  if (action === 'finish') {
    if (!/^✅/.test(ev.summary || '')) {
      await cal.events.patch({ calendarId: 'primary', eventId, requestBody: { summary: `✅ ${ev.summary}` } });
    }
    return 'Marked as finished ✅';
  }
  if (action === 'postpone') {
    const m = minutes || 30;
    await cal.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody: {
        start: { dateTime: new Date(start + m * MIN).toISOString(), timeZone: ev.start.timeZone },
        end: { dateTime: new Date(end + m * MIN).toISOString(), timeZone: ev.end.timeZone },
      },
    });
    return `Postponed by ${m} minutes`;
  }
  const cut = minutes || 15;
  const newEnd = Math.max(start + 15 * MIN, end - cut * MIN);
  await cal.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody: { end: { dateTime: new Date(newEnd).toISOString(), timeZone: ev.end.timeZone } },
  });
  return `Shortened by ${Math.round((end - newEnd) / MIN)} minutes`;
}

module.exports = { loadTasks, scheduleUser, applyAction };
