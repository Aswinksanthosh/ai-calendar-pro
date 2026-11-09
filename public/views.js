import { h } from './dom.js';
import { sameDay, monthGrid, eventsOnDay, layoutDay, fmtTime } from './dates.js';

export const HOUR = 48; // pixels per hour in the time grid

function chip(ev, onEvent) {
  return h('button', {
    class: 'chip' + (ev.allDay ? ' allday' : ''),
    style: { '--c': ev.color, '--fg': ev.fg },
    title: ev.title,
    onclick: (e) => { e.stopPropagation(); onEvent(ev); },
  }, ev.allDay ? ev.title : [h('i', { class: 'dot' }), `${fmtTime(ev.start)} ${ev.title}`]);
}

export function renderMonth(root, { date, events, today, weekStart, onDay, onEvent }) {
  const weeks = monthGrid(date, weekStart);
  const MAX = 3;
  const head = h('div', { class: 'mh' }, ...weeks[0].map((d) => h('div', {}, d.toLocaleDateString([], { weekday: 'short' }))));
  const grid = h('div', { class: 'mg', style: { '--rows': String(weeks.length) } },
    ...weeks.flat().map((d) => {
      const evs = eventsOnDay(events, d);
      return h('div', {
        class: 'cell' + (d.getMonth() !== date.getMonth() ? ' out' : '') + (sameDay(d, today) ? ' today' : ''),
        onclick: () => onDay(d),
      },
      h('span', { class: 'num' }, String(d.getDate())),
      ...evs.slice(0, MAX).map((e) => chip(e, onEvent)),
      evs.length > MAX ? h('span', { class: 'more' }, `+${evs.length - MAX}`) : null);
    }));
  root.replaceChildren(head, grid);
}

/** Week / 3-day / day view. Returns the scrollable body so the caller can control scrolling. */
export function renderGrid(root, { days, events, today, onSlot, onEvent }) {
  const n = String(days.length);
  const now = new Date();
  const head = h('div', { class: 'tg-head', style: { '--n': n } },
    h('div', { class: 'gutter' }),
    ...days.map((d) => h('div', { class: 'dh' + (sameDay(d, today) ? ' today' : '') },
      h('small', {}, d.toLocaleDateString([], { weekday: 'short' })), h('b', {}, String(d.getDate())))));

  const allDayRows = days.map((d) => eventsOnDay(events, d).filter((e) => e.allDay));
  const allday = allDayRows.some((r) => r.length)
    ? h('div', { class: 'tg-all', style: { '--n': n } }, h('div', { class: 'gutter' }),
      ...allDayRows.map((r) => h('div', { class: 'ad' }, ...r.map((e) => chip(e, onEvent)))))
    : null;

  const hours = h('div', { class: 'gutter hours' },
    ...Array.from({ length: 24 }, (_, i) => h('div', { class: 'hl' }, i ? new Date(2000, 0, 1, i).toLocaleTimeString([], { hour: 'numeric' }) : '')));

  const cols = days.map((d) => {
    const timed = eventsOnDay(events, d).filter((e) => !e.allDay);
    const col = h('div', {
      class: 'col',
      onclick: (ev) => {
        const y = ev.clientY - col.getBoundingClientRect().top;
        onSlot(d, Math.max(0, Math.min(1410, Math.floor((y / HOUR) * 2) * 30)));
      },
    }, ...layoutDay(timed, d).map((it) => h('button', {
      class: 'ev' + (it.end - it.start < 50 ? ' short' : ''),
      style: {
        top: `${(it.start / 60) * HOUR}px`,
        height: `${Math.max(18, ((it.end - it.start) / 60) * HOUR - 2)}px`,
        left: `${(it.col / it.cols) * 100}%`,
        width: `calc(${100 / it.cols}% - 2px)`,
        '--c': it.event.color, '--fg': it.event.fg,
      },
      onclick: (e) => { e.stopPropagation(); onEvent(it.event); },
    }, h('b', {}, it.event.title), h('small', {}, fmtTime(it.event.start)))));
    if (sameDay(d, now)) col.append(h('div', { class: 'now', style: { top: `${((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR}px` } }));
    return col;
  });

  const body = h('div', { class: 'tg-body', style: { '--n': n, '--hour': `${HOUR}px` } }, hours, ...cols);
  root.replaceChildren(head, ...(allday ? [allday] : []), body);
  return body;
}
