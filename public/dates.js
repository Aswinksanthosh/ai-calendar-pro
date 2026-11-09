// Pure date, layout and Google-event helpers. No DOM and no network, so they can be unit tested.

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const parseYmd = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const sameDay = (a, b) => ymd(a) === ymd(b);

/** Month arithmetic that clamps (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(d, n) {
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d.getDate(), last));
  return t;
}

/** weekStart: 0 = Sunday, 1 = Monday. */
export const startOfWeek = (d, weekStart = 0) => addDays(startOfDay(d), -((d.getDay() - weekStart + 7) % 7));

/** Weeks (arrays of 7 days) covering the month of `d`: 5 or 6 rows. */
export function monthGrid(d, weekStart = 0) {
  const start = startOfWeek(new Date(d.getFullYear(), d.getMonth(), 1), weekStart);
  const weeks = [];
  for (let w = 0; w < 6; w++) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i)));
  // Drop trailing rows that lie entirely in the next month.
  while (weeks.length > 4 && weeks[weeks.length - 1][0].getMonth() !== d.getMonth()) weeks.pop();
  return weeks;
}

export const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// ---------- events ----------

/** Google API event + its calendar -> flat object the views use. */
export function normalizeEvent(e, cal) {
  const allDay = !!e.start.date;
  return {
    id: e.id,
    calId: cal.id,
    title: e.summary || '(No title)',
    allDay,
    start: allDay ? parseYmd(e.start.date) : new Date(e.start.dateTime),
    end: allDay ? parseYmd(e.end.date) : new Date(e.end.dateTime),
    color: cal.backgroundColor || '#4f46e5',
    fg: cal.foregroundColor || '#ffffff',
    raw: e,
  };
}

/** Events that touch `day`, all-day ones first. All-day end dates are exclusive. */
export function eventsOnDay(events, day) {
  const s = startOfDay(day);
  const e = addDays(s, 1);
  return events
    .filter((ev) => ev.start < e && Math.max(ev.end.getTime(), ev.start.getTime() + 1) > s.getTime())
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
}

/**
 * Side-by-side layout for overlapping timed events in one day column.
 * Returns [{event, start, end (minutes from midnight), col, cols}].
 */
export function layoutDay(events, day) {
  const ds = startOfDay(day).getTime();
  const de = addDays(startOfDay(day), 1).getTime();
  const items = events
    .map((event) => {
      const s = Math.max(event.start.getTime(), ds);
      const e = Math.min(event.end.getTime(), de);
      const start = (s - ds) / 60000;
      let end = (e - ds) / 60000;
      if (end - start < 30) end = Math.min(1440, start + 30); // minimum visible height
      return { event, start, end };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const it of cluster) {
      let c = cols.findIndex((end) => end <= it.start);
      if (c < 0) { c = cols.length; cols.push(it.end); } else cols[c] = it.end;
      it.col = c;
    }
    cluster.forEach((it) => { it.cols = cols.length; });
    out.push(...cluster);
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.start >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return out;
}

// ---------- event form <-> Google API body ----------

const RRULES = {
  daily: ['RRULE:FREQ=DAILY'],
  weekly: ['RRULE:FREQ=WEEKLY'],
  monthly: ['RRULE:FREQ=MONTHLY'],
  yearly: ['RRULE:FREQ=YEARLY'],
};

/** 'none' | daily | weekly | monthly | yearly | 'keep' (complex rule we must not overwrite). */
export function recurrenceKind(recurrence) {
  const rules = (recurrence || []).filter((r) => r.startsWith('RRULE'));
  if (!rules.length) return 'none';
  for (const [k, v] of Object.entries(RRULES)) if (rules.length === 1 && rules[0] === v[0]) return k;
  return 'keep';
}

/** Reminder select value: 'default' | 'none' | minutes as string. */
export function reminderKind(r) {
  if (!r || r.useDefault) return 'default';
  const o = (r.overrides || [])[0];
  return o ? String(o.minutes) : 'none';
}

export function eventToForm(ev) {
  const raw = ev.raw;
  const endShown = ev.allDay ? addDays(ev.end, -1) : ev.end;
  return {
    title: raw.summary || '',
    allDay: ev.allDay,
    startDate: ymd(ev.start),
    startTime: ev.allDay ? '09:00' : hm(ev.start),
    endDate: ymd(endShown),
    endTime: ev.allDay ? '10:00' : hm(ev.end),
    description: raw.description || '',
    location: raw.location || '',
    recurrence: raw.recurringEventId ? 'keep' : recurrenceKind(raw.recurrence),
    reminder: reminderKind(raw.reminders),
  };
}

/** Returns an error message or ''. */
export function validateForm(f) {
  if (!f.startDate || !f.endDate) return 'Please pick a date.';
  if (f.allDay) return f.endDate < f.startDate ? 'End date is before the start date.' : '';
  if (!f.startTime || !f.endTime) return 'Please pick a time.';
  const s = new Date(`${f.startDate}T${f.startTime}`);
  const e = new Date(`${f.endDate}T${f.endTime}`);
  return e > s ? '' : 'The event must end after it starts.';
}

export function buildEventBody(f, tz, { editing = false } = {}) {
  const body = { summary: f.title.trim(), description: f.description || '', location: f.location || '' };
  // On edits (PATCH) the unused field must be cleared with null, or switching all-day <-> timed fails.
  const clearDate = editing ? { date: null } : {};
  const clearTime = editing ? { dateTime: null, timeZone: null } : {};
  if (f.allDay) {
    body.start = { date: f.startDate, ...clearTime };
    body.end = { date: ymd(addDays(parseYmd(f.endDate || f.startDate), 1)), ...clearTime };
  } else {
    body.start = { dateTime: new Date(`${f.startDate}T${f.startTime}`).toISOString(), timeZone: tz, ...clearDate };
    body.end = { dateTime: new Date(`${f.endDate}T${f.endTime}`).toISOString(), timeZone: tz, ...clearDate };
  }
  if (RRULES[f.recurrence]) body.recurrence = RRULES[f.recurrence];
  else if (f.recurrence === 'none' && editing) body.recurrence = [];
  body.reminders =
    f.reminder === 'default' ? { useDefault: true }
      : f.reminder === 'none' ? { useDefault: false, overrides: [] }
        : { useDefault: false, overrides: [{ method: 'popup', minutes: Number(f.reminder) }] };
  return body;
}

/** Move a recurring series' master start/end by the same amount an instance was moved. */
export function shiftBody(master, deltaStartMs, deltaEndMs) {
  const shift = (t, d) =>
    t.date
      ? { date: ymd(addDays(parseYmd(t.date), Math.round(d / 86400000))) }
      : { dateTime: new Date(Date.parse(t.dateTime) + d).toISOString(), ...(t.timeZone ? { timeZone: t.timeZone } : {}) };
  return { start: shift(master.start, deltaStartMs), end: shift(master.end, deltaEndMs) };
}
