'use strict';
// Time helpers: parsing "7pm" / "1h30m" and converting local time <-> UTC for any IANA timezone.

const MIN = 60 * 1000;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** "7pm", "1:30pm", "13:00", "9" -> minutes after midnight, or null. */
function parseClock(input) {
  if (input == null) return null;
  const m = String(input).trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = +m[1];
  const mi = +(m[2] || 0);
  const ap = m[3];
  if (mi > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'pm' && h !== 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return h * 60 + mi;
}

/** "1h", "30m", "1h30m", "1:30h", "90" -> minutes, or null. */
function parseDuration(input) {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase();
  let m;
  if ((m = s.match(/^(\d+):(\d{2})\s*h?$/))) return +m[1] * 60 + +m[2];
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/))) {
    return Math.round(+m[1] * 60 + (m[2] ? +m[2] : 0));
  }
  if ((m = s.match(/^(\d+)\s*m(?:in(?:ute)?s?)?$/))) return +m[1];
  if (/^\d+$/.test(s)) return +s;
  return null;
}

function tzOffsetMinutes(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUtc - utcMs) / MIN;
}

/** Local date "YYYY-MM-DD" + minutes after local midnight (may exceed 1440) -> UTC ms. */
function zonedToUtcMs(dateStr, minutes, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, 0, minutes);
  const off1 = tzOffsetMinutes(guess, tz);
  let utc = guess - off1 * MIN;
  const off2 = tzOffsetMinutes(utc, tz);
  if (off2 !== off1) utc = guess - off2 * MIN;
  return utc;
}

/** UTC ms -> { date: "YYYY-MM-DD", minutes } in the timezone. */
function utcMsToZoned(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute };
}

function weekdayKey(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
}

function addDays(dateStr, n) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

module.exports = {
  MIN, DAYS, parseClock, parseDuration, zonedToUtcMs, utcMsToZoned, weekdayKey, addDays,
};
