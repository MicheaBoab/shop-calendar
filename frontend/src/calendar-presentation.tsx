import { useEffect, useRef, type MutableRefObject, type ReactNode } from 'react';

// Keep input/agenda formatting unchanged; calendar boxes explicitly use AM/PM.
export const formatTimeOnly = (value: string, locale: string, hour12 = false) =>
  new Intl.DateTimeFormat(hour12 ? 'en-US' : locale, {
    hour: '2-digit', minute: '2-digit', hour12,
  }).format(new Date(value));

export function CalendarEventBox({ start, end, locale, title, note, cancelledLabel }: {
  start: Date | null; end: Date | null; locale: string; title: string;
  note: string | null; cancelledLabel?: string;
}) {
  const startLabel = start ? formatTimeOnly(start.toISOString(), locale, true) : '';
  const endLabel = end ? formatTimeOnly(end.toISOString(), locale, true) : '';
  return (
    <div className="calendar-event-content" title={[startLabel, endLabel, title, cancelledLabel, note].filter(Boolean).join(' • ')}>
      <div className="calendar-event-time calendar-event-start">{startLabel}</div>
      <div className="calendar-event-details">
        <div className="calendar-event-title">{title}</div>
        {cancelledLabel ? <div className="calendar-event-status-badge">{cancelledLabel}</div> : null}
        {note ? <div className="calendar-event-note">{note}</div> : null}
      </div>
      <div className="calendar-event-time calendar-event-end">{endLabel}</div>
    </div>
  );
}

const clockSeconds = (value: string) => {
  const [hours, minutes = 0, seconds = 0] = value.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
};

// Returns false until FullCalendar has a measurable, scrollable time grid.
export function centerCurrentTime(root: HTMLElement, slotMinTime: string, slotMaxTime: string, now = new Date()): boolean {
  const slots = Array.from(root.querySelectorAll<HTMLElement>('.fc-timegrid-slots .fc-timegrid-slot-lane[data-time]'));
  const first = slots[0];
  const last = slots[slots.length - 1];
  const scroller = first?.closest<HTMLElement>('.fc-scroller');
  if (!first || !last || !scroller || !root.isConnected || scroller.clientHeight <= 0) return false;
  const firstRect = first.getBoundingClientRect();
  const lastRect = last.getBoundingClientRect();
  if (firstRect.height <= 0 || lastRect.height <= 0) return false;

  const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const min = clockSeconds(first.dataset.time!);
  const max = clockSeconds(slotMaxTime);
  // React settings may precede FullCalendar's delayed DOM update.
  if (min !== clockSeconds(slotMinTime) ||
    clockSeconds(last.dataset.time!) !== min + Math.floor((max - min - 1) / 1800) * 1800) return false;
  const target = Math.max(min, Math.min(max, seconds));
  let y = lastRect.bottom;
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const start = clockSeconds(slot.dataset.time!);
    const end = index + 1 < slots.length ? clockSeconds(slots[index + 1].dataset.time!) : max;
    if (target < end) {
      const rect = slot.getBoundingClientRect();
      y = rect.top + rect.height * (target - start) / (end - start);
      break;
    }
  }
  const rect = scroller.getBoundingClientRect();
  const viewportTop = rect.top + scroller.clientTop;
  const visibleTop = Math.max(viewportTop, 0);
  const visibleBottom = Math.min(viewportTop + scroller.clientHeight, window.innerHeight);
  if (visibleBottom <= visibleTop) return false;
  const delta = y - (visibleTop + visibleBottom) / 2;
  scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, scroller.scrollTop + delta));
  return true;
}

export function waitForInitialCalendarLayout(
  root: HTMLElement, slotMinTime: string, slotMaxTime: string, consumed: MutableRefObject<boolean>,
): () => void {
  let stopped = false;
  let frame = 0;
  let observer: MutationObserver | undefined;
  let resizeObserver: ResizeObserver | undefined;
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule, true);
  };
  const attempt = () => {
    frame = 0;
    if (stopped || consumed.current) return;
    if (centerCurrentTime(root, slotMinTime, slotMaxTime)) {
      consumed.current = true;
      stop();
    }
  };
  const schedule = () => {
    if (!stopped && !frame) frame = requestAnimationFrame(attempt);
  };
  observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true, attributes: true });
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(root);
  }
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, true);
  schedule();
  return stop;
}

export function CalendarFrame({ ready, layoutKey, slotMinTime, slotMaxTime, consumed, children }: {
  ready: boolean;
  layoutKey: string;
  slotMinTime: string;
  slotMaxTime: string;
  consumed: MutableRefObject<boolean>;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ready || consumed.current || !root.current) return;
    return waitForInitialCalendarLayout(root.current, slotMinTime, slotMaxTime, consumed);
  }, [ready, layoutKey, slotMinTime, slotMaxTime, consumed]);
  return <div className="calendar-frame" ref={root}>{children}</div>;
}
