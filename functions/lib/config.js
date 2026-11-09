'use strict';
// Turns a task document (as stored in Firestore, friendly strings) into a validated config.

const { parseClock, parseDuration, DAYS } = require('./time');

/** "✅ Gym" / "  gym " -> "gym". Used for matching and duplicate detection. */
function cleanTaskName(title) {
  return String(title || '')
    .replace(/[✅☑✔️]/g, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim()
    .toLowerCase();
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** "sleep:240, meeting" -> [{name:'sleep',gap:240},{name:'meeting',gap:60}] */
function parseAvoid(list) {
  const items = Array.isArray(list) ? list : String(list || '').split(',');
  return items
    .map((x) => String(x).trim())
    .filter(Boolean)
    .map((x) => {
      const [name, gap] = x.split(':');
      return { name: cleanTaskName(name), gap: num(gap, 60) };
    });
}

function parseDeps(list) {
  return (Array.isArray(list) ? list : [])
    .filter((d) => d && d.task)
    .map((d) => ({ task: cleanTaskName(d.task), gap: num(d.gap, 0) }));
}

/**
 * Returns { ok: true, task } or { ok: false, errors: [...] }.
 * Priority: 1 = most important (scheduled first), higher number = less important.
 */
function normalizeTask(raw) {
  const errors = [];
  const name = String(raw.name || '').trim();
  const key = cleanTaskName(name);
  if (!key) errors.push('name is required');

  const duration = parseDuration(raw.duration || '1h');
  if (!duration || duration < 5) errors.push(`invalid duration "${raw.duration}"`);

  let idealMin = null;
  if (raw.idealTime) {
    idealMin = parseClock(raw.idealTime);
    if (idealMin == null) errors.push(`invalid ideal time "${raw.idealTime}"`);
  }

  const dayTimes = {};
  for (const d of DAYS) {
    const v = raw.dayTimes && raw.dayTimes[d];
    if (v) {
      const m = parseClock(v);
      if (m == null) errors.push(`invalid ${d} time "${v}"`);
      else dayTimes[d] = m;
    }
  }

  const windowStart = raw.windowStart ? parseClock(raw.windowStart) : 6 * 60;
  const windowEnd = raw.windowEnd ? parseClock(raw.windowEnd) : 22 * 60;
  if (windowStart == null || windowEnd == null) errors.push('invalid time window');

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    task: {
      name,
      key,
      duration,
      idealMin,
      dayTimes,
      movable: raw.movable !== false,
      priority: num(raw.priority, 3),
      bufferBefore: num(raw.bufferBefore, 0),
      bufferAfter: num(raw.bufferAfter, 0),
      avoid: parseAvoid(raw.avoid),
      after: parseDeps(raw.after),
      before: parseDeps(raw.before),
      windowStart,
      windowEnd,
    },
  };
}

module.exports = { cleanTaskName, normalizeTask, parseAvoid };
