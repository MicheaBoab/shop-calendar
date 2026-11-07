import { useEffect, useId, useRef, useState } from 'react';
import { formatDateForUsInput, parseUsDateInput } from './appointment-time';
import { useI18n } from './i18n/i18n';

// Appointment dates are shop-local calendar dates, never UTC instants.
// Buttons only: no editable native date field, paste target or clear action.
export function AppointmentDateChooser({ value, onChange }: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { locale, t } = useI18n();
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => parseUsDateInput(value) ?? new Date());
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    host.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  return <div ref={host} className="appointment-date-chooser"
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
    <button ref={trigger} type="button" aria-expanded={open} aria-controls={id}
      onClick={() => {
        if (open) { close(); return; }
        setMonth(parseUsDateInput(value) ?? new Date());
        setOpen(true);
      }}>{t('editor.chooseDate')}</button>
    {open && <div id={id} className="appointment-date-panel" role="group" aria-label={t('editor.chooseDate')}>
      <div className="appointment-date-heading">
        <button type="button" aria-label={t('calendar.prev')}
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
        <strong aria-live="polite">{first.toLocaleDateString(locale, { year: 'numeric', month: 'long' })}</strong>
        <button type="button" aria-label={t('calendar.next')}
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
      </div>
      <div className="appointment-date-grid">
        {days.slice(0, 7).map((day) => <span key={day.getDay()}>
          {day.toLocaleDateString(locale, { weekday: 'short' })}
        </span>)}
        {days.map((day) => {
          const date = formatDateForUsInput(day);
          return <button key={date} type="button" aria-label={date}
            aria-pressed={date === value}
            className={day.getMonth() !== month.getMonth() ? 'outside-month' : ''}
            onClick={() => { onChange(date); close(); }}>{day.getDate()}</button>;
        })}
      </div>
    </div>}
  </div>;
}
