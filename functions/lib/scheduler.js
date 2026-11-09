'use strict';
// Pure scheduling engine (no Firebase / Google calls) so it can be unit tested.
// Port of the n8n "FindandFillTheSlots" + dependency logic.

const { MIN, zonedToUtcMs, weekdayKey } = require('./time');

const STEP = 15 * MIN;

function byPriority(a, b) {
  if (a.movable !== b.movable) return a.movable ? 1 : -1; // fixed tasks first
  return a.priority - b.priority;
}

/** An occupied interval, widened by its own task's buffers when we know them. */
function expanded(iv, taskMap) {
  const t = taskMap[iv.key];
  return {
    s: iv.startMs - (t ? t.bufferBefore : 0) * MIN,
    e: iv.endMs + (t ? t.bufferAfter : 0) * MIN,
  };
}

function isFree(task, startMs, endMs, occupied, taskMap) {
  const cs = startMs - task.bufferBefore * MIN;
  const ce = endMs + task.bufferAfter * MIN;
  for (const o of occupied) {
    const ex = expanded(o, taskMap);
    const rule = task.avoid.find((a) => a.name && a.name === o.key);
    const extra = rule ? rule.gap * MIN : 0;
    if (cs < ex.e + extra && ex.s - extra < ce) return false;
  }
  return true;
}

function placeTask(task, ctx) {
  const { date, tz, occupied, taskMap, placed, nowMs } = ctx;
  const dur = task.duration * MIN;
  const idealMin = task.dayTimes[weekdayKey(date)] ?? task.idealMin ?? task.windowStart;
  const ideal = zonedToUtcMs(date, idealMin, tz);

  if (!task.movable) {
    return { task, startMs: ideal, endMs: ideal + dur, status: 'fixed' };
  }

  let lb = zonedToUtcMs(date, task.windowStart, tz);
  let ub = zonedToUtcMs(date, task.windowEnd, tz);
  if (nowMs != null) lb = Math.max(lb, Math.ceil(nowMs / STEP) * STEP);
  for (const d of task.after) {
    const o = placed.get(d.task);
    if (o) lb = Math.max(lb, o.endMs + d.gap * MIN);
  }
  for (const d of task.before) {
    const o = placed.get(d.task);
    if (o) ub = Math.min(ub, o.startMs - d.gap * MIN);
  }

  const fits = (s) => s >= lb && s + dur <= ub && isFree(task, s, s + dur, occupied, taskMap);
  // Try the ideal time first, then move outward in 15-minute steps (later first).
  for (let k = 0; ; k++) {
    const fwd = ideal + k * STEP;
    const back = ideal - k * STEP;
    if (fwd + dur > ub && back < lb) break;
    if (fits(fwd)) return { task, startMs: fwd, endMs: fwd + dur, status: k === 0 ? 'ideal' : 'moved' };
    if (k > 0 && fits(back)) return { task, startMs: back, endMs: back + dur, status: 'moved' };
  }
  return { task, startMs: null, endMs: null, status: 'no-slot' };
}

/**
 * @param {object} p
 * @param {string} p.date       local day "YYYY-MM-DD"
 * @param {string} p.tz         IANA timezone
 * @param {object[]} p.requested normalized tasks that need a timed event today
 * @param {object[]} p.busy     existing timed events: {startMs,endMs,key}
 * @param {object} p.taskMap    key -> normalized task (for buffers)
 * @param {number} [p.nowMs]    never place movable tasks before this time
 * @returns {object[]} results {task,startMs,endMs,status}
 */
function planDay({ date, tz, requested, busy, taskMap, nowMs }) {
  const results = [];
  const occupied = busy.map((b) => ({ ...b }));
  const placed = new Map();
  for (const b of busy) if (b.key && !placed.has(b.key)) placed.set(b.key, b);

  const wanted = new Set(requested.map((t) => t.key));
  const pending = [...requested].sort(byPriority);
  const ready = (t) =>
    [...t.after, ...t.before].every((d) => d.task === t.key || placed.has(d.task) || !wanted.has(d.task));

  while (pending.length) {
    let idx = pending.findIndex(ready);
    if (idx < 0) idx = 0; // dependency cycle or failed dependency: place anyway
    const [task] = pending.splice(idx, 1);
    const r = placeTask(task, { date, tz, occupied, taskMap, placed, nowMs });
    results.push(r);
    if (r.startMs != null) {
      const iv = { startMs: r.startMs, endMs: r.endMs, key: task.key };
      occupied.push(iv);
      placed.set(task.key, iv);
    }
  }
  return results;
}

module.exports = { planDay, placeTask, STEP };
