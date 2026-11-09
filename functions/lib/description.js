'use strict';
// Human readable event description (same look as the n8n project) + action links.

const { DAYS } = require('./time');

function fmtMin(m) {
  const h = Math.floor(m / 60) % 24;
  const mi = m % 60;
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return mi ? `${h12}:${String(mi).padStart(2, '0')}${ap}` : `${h12}${ap}`;
}

function fmtDur(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h}h` : '', m ? `${m}m` : ''].join('') || '0m';
}

/** links: { finish, postpone, compress } URLs. Google Calendar renders basic HTML. */
function buildDescription(task, links, status) {
  const lines = [
    '📋 TASK CONFIGURATION',
    '',
    `⏰ Ideal Time: ${task.idealMin != null ? fmtMin(task.idealMin) : 'auto'}`,
    `🔄 Movable: ${task.movable ? 'Yes' : 'No'}`,
    `⭐ Priority: ${task.priority}`,
    `⏳ Duration: ${fmtDur(task.duration)}`,
  ];
  const day = DAYS.filter((d) => task.dayTimes[d] != null).map((d) => `${d}: ${fmtMin(task.dayTimes[d])}`);
  if (day.length) lines.push('', '📅 DAY-SPECIFIC TIMES: ' + day.join(', '));
  if (task.bufferBefore || task.bufferAfter) lines.push(`↔️ Buffers: ${task.bufferBefore}m before, ${task.bufferAfter}m after`);
  if (task.after.length) lines.push('➡️ After: ' + task.after.map((d) => `${d.task} (+${d.gap}m)`).join(', '));
  if (task.before.length) lines.push('⬅️ Before: ' + task.before.map((d) => `${d.task} (-${d.gap}m)`).join(', '));
  if (task.avoid.length) lines.push('🚫 Avoid: ' + task.avoid.map((a) => `${a.name} (${a.gap}m)`).join(', '));
  lines.push('', `🤖 Scheduled by ai-calendar-pro (${status})`);
  const html = lines.map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>');
  const a = (href, label) => `<a href="${href}">${label}</a>`;
  const actions = links
    ? '<br><br>' + [a(links.finish, '✅ FINISH'), a(links.postpone, '⏭ POSTPONE 30m'), a(links.compress, '✂️ COMPRESS 15m')].join(' &nbsp;|&nbsp; ')
    : '';
  return html + actions;
}

module.exports = { buildDescription, fmtMin, fmtDur };
