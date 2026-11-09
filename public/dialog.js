import { $, h } from './dom.js';
import { ymd, hm, validateForm } from './dates.js';

const REMINDERS = [
  ['default', 'Default reminder'], ['none', 'No reminder'], ['10', '10 minutes before'],
  ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before'],
];
const REPEATS = [['none', 'Does not repeat'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['yearly', 'Every year']];

const fill = (select, options, value) => {
  select.replaceChildren(...options.map(([v, label]) => h('option', { value: v, textContent: label })));
  select.value = value;
};

/**
 * Opens the create / edit dialog.
 * o: { isNew, form, calendars:[{id,summary}], calId, recurring, readOnly, onSave(form, scope, calId), onDelete(scope) }
 * onSave / onDelete may throw; the message is shown in the dialog and it stays open.
 */
export function openEventDialog(o) {
  const dlg = $('evDialog');
  const f = o.form;
  const allDay = () => $('evAllDay').checked;

  $('evDialogTitle').textContent = o.isNew ? 'New event' : o.readOnly ? 'Event' : 'Edit event';
  $('evTitle').value = f.title;
  $('evAllDay').checked = f.allDay;
  $('evSd').value = f.startDate; $('evSt').value = f.startTime;
  $('evEd').value = f.endDate; $('evEt').value = f.endTime;
  $('evLoc').value = f.location; $('evDesc').value = f.description;

  fill($('evCal'), o.calendars.map((c) => [c.id, c.summary]), o.calId);
  $('evCal').disabled = !o.isNew; // moving events between calendars is not supported yet

  const repeats = f.recurrence === 'keep' ? [['keep', 'Repeats (set in Google Calendar)'], ...REPEATS] : REPEATS;
  fill($('evRepeat'), repeats, f.recurrence);
  $('evRepeat').disabled = f.recurrence === 'keep';

  const reminders = REMINDERS.some(([v]) => v === f.reminder) ? REMINDERS : [...REMINDERS, [f.reminder, `${f.reminder} minutes before`]];
  fill($('evReminder'), reminders, f.reminder);

  $('evScope').hidden = !o.recurring;
  $('evScope').querySelector('input[value="this"]').checked = true;
  const scope = () => ($('evScope').querySelector('input:checked') || {}).value || 'this';

  $('evError').textContent = '';
  $('evDelete').hidden = o.isNew || o.readOnly;
  $('evSave').hidden = o.readOnly;
  for (const el of $('evForm').querySelectorAll('input:not([type=radio]), textarea')) el.disabled = !!o.readOnly;
  if (o.readOnly) { $('evRepeat').disabled = true; $('evReminder').disabled = true; }

  const showTimes = () => { $('evSt').hidden = $('evEt').hidden = allDay(); };
  showTimes();
  $('evAllDay').onchange = showTimes;

  // Moving the start moves the end by the same amount (keeps the duration), like Google Calendar.
  const startMs = () => new Date(`${$('evSd').value}T${allDay() ? '00:00' : $('evSt').value || '00:00'}`).getTime();
  let prev = startMs();
  const onStart = () => {
    const now = startMs();
    const delta = now - prev;
    if (Number.isFinite(delta) && delta) {
      const end = new Date(`${$('evEd').value}T${allDay() ? '00:00' : $('evEt').value || '00:00'}`);
      const moved = new Date(end.getTime() + delta);
      if (!Number.isNaN(moved.getTime())) {
        $('evEd').value = ymd(moved);
        if (!allDay()) $('evEt').value = hm(moved);
      }
    }
    if (Number.isFinite(now)) prev = now;
  };
  $('evSd').onchange = onStart;
  $('evSt').onchange = onStart;

  const collect = () => ({
    title: $('evTitle').value, allDay: allDay(),
    startDate: $('evSd').value, startTime: $('evSt').value, endDate: $('evEd').value, endTime: $('evEt').value,
    description: $('evDesc').value, location: $('evLoc').value,
    recurrence: $('evRepeat').value, reminder: $('evReminder').value,
  });

  const busy = (on) => { $('evSave').disabled = on; $('evDelete').disabled = on; };
  const run = async (fn) => {
    busy(true);
    try { await fn(); dlg.close(); } catch (err) { $('evError').textContent = err.message; } finally { busy(false); }
  };

  $('evForm').onsubmit = (e) => {
    e.preventDefault();
    const data = collect();
    const problem = validateForm(data);
    if (problem) { $('evError').textContent = problem; return; }
    run(() => o.onSave(data, scope(), $('evCal').value));
  };
  $('evDelete').onclick = () => {
    if (!o.recurring && !confirm('Delete this event?')) return;
    if (o.recurring && scope() === 'all' && !confirm('Delete ALL events in this series?')) return;
    run(() => o.onDelete(scope()));
  };
  $('evCancel').onclick = () => dlg.close();
  dlg.showModal();
  if (o.isNew) $('evTitle').focus();
}
