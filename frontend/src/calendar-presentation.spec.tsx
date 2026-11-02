// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarFrame, centerCurrentTime, formatTimeOnly, waitForInitialCalendarLayout } from './calendar-presentation';

function grid() {
  const root = document.createElement('div');
  root.innerHTML = '<div class="fc-scroller"><table class="fc-timegrid-slots"><tbody></tbody></table></div>';
  document.body.append(root);
  const scroller = root.firstElementChild as HTMLElement;
  scroller.scrollTop = 100;
  Object.defineProperties(scroller, {
    clientHeight: { value: 400 }, scrollHeight: { value: 1600 },
  });
  scroller.getBoundingClientRect = () => ({ top: 100, height: 400 } as DOMRect);
  for (let index = 0; index < 32; index++) {
    const row = document.createElement('td');
    row.className = 'fc-timegrid-slot-lane';
    row.dataset.time = `${String(8 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}:00`;
    row.getBoundingClientRect = () => ({
      top: 100 + index * 50 - scroller.scrollTop,
      bottom: 150 + index * 50 - scroller.scrollTop, height: 50,
    } as DOMRect);
    const tr = document.createElement('tr');
    tr.append(row);
    root.querySelector('tbody')!.append(tr);
  }
  return { root, scroller };
}

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('calendar presentation', () => {
  it('formats midnight/noon in local time with AM/PM while retaining existing 24-hour formatting', () => {
    const midnight = new Date(2026, 6, 30, 0, 0).toISOString();
    const noon = new Date(2026, 6, 30, 12, 0).toISOString();
    expect(formatTimeOnly(midnight, 'zh-CN', true)).toBe('12:00 AM');
    expect(formatTimeOnly(noon, 'zh-CN', true)).toBe('12:00 PM');
    expect(formatTimeOnly(noon, 'en-US')).toBe('12:00');
  });

  it.each([[15, 0, 0, 500], [15, 15, 0, 525], [7, 0, 0, 0], [23, 0, 0, 1200], [23, 30, 0, 1200], [23, 59, 59, 1200]])(
    'measures center and clamps at %i:%i', (hour, minute, second, expected) => {
      const { root, scroller } = grid();
      expect(centerCurrentTime(root, '08:00:00', '24:00:00', new Date(2026, 6, 30, hour, minute, second))).toBe(true);
      expect(scroller.scrollTop).toBe(expected);
    });

  it('does not consume initial positioning for stale, invisible or detached geometry', () => {
    const { root, scroller } = grid();
    expect(centerCurrentTime(root, '07:00:00', '24:00:00')).toBe(false);
    expect(centerCurrentTime(root, '08:00:00', '23:00:00')).toBe(false);
    expect(scroller.scrollTop).toBe(100);
    root.remove();
    expect(centerCurrentTime(root, '10:00:00', '23:00:00')).toBe(false);
  });

  it('consumes only once and cancels pending work on cleanup', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; });
    vi.stubGlobal('cancelAnimationFrame', (key: number) => { callbacks.delete(key); });
    const { root, scroller } = grid();
    const consumed = { current: false };
    const stop = waitForInitialCalendarLayout(root, '08:00:00', '24:00:00', consumed);
    expect(consumed.current).toBe(false);
    for (const [key, callback] of [...callbacks]) { callbacks.delete(key); callback(0); }
    expect(consumed.current).toBe(true);
    scroller.scrollTop = 123;
    window.dispatchEvent(new Event('resize'));
    expect(callbacks.size).toBe(0);
    expect(scroller.scrollTop).toBe(123);
    stop();
    const unconsumed = { current: false };
    const cancel = waitForInitialCalendarLayout(root, '08:00:00', '24:00:00', unconsumed);
    cancel();
    expect(callbacks.size).toBe(0);
    expect(unconsumed.current).toBe(false);
  });

  it('waits for settings, and never repositions after refresh, view rebuild or calendar remount', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const raf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const host = document.createElement('div');
    document.body.append(host);
    const renderRoot = createRoot(host);
    const consumed = { current: false };
    const render = (ready: boolean, layoutKey = 'threeDay') => <CalendarFrame ready={ready} layoutKey={layoutKey}
      slotMinTime="08:00:00" slotMaxTime="24:00:00" consumed={consumed}><div /></CalendarFrame>;
    try {
      await act(async () => renderRoot.render(render(false)));
      expect(raf).not.toHaveBeenCalled();
      await act(async () => renderRoot.render(render(true)));
      expect(raf).toHaveBeenCalledTimes(1);
      consumed.current = true;
      await act(async () => renderRoot.render(render(true)));
      await act(async () => renderRoot.render(render(true, 'day')));
      await act(async () => renderRoot.render(render(true, 'threeDay')));
      await act(async () => renderRoot.render(null));
      await act(async () => renderRoot.render(render(true)));
      expect(raf).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => renderRoot.unmount());
    }
  });
});
