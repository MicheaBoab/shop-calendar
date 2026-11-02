import { describe, expect, it } from 'vitest';
import {
  CALENDAR_SLOT_MAX_TIME,
  CALENDAR_SLOT_MIN_TIME,
  deriveCalendarDisplayWindow,
  isCalendarStartWithinBusinessHours,
  isValidCalendarWindowRange,
  normalizeCalendarWindowSettings,
  toCalendarTimeInputValue,
  toCalendarTimePayloadValue,
} from './calendar-time-window';

describe('calendar time window', () => {
  it('starts at 10:00 AM', () => {
    expect(CALENDAR_SLOT_MIN_TIME).toBe('10:00:00');
  });

  it('ends at 8:00 PM with FullCalendar exclusive max semantics', () => {
    expect(CALENDAR_SLOT_MAX_TIME).toBe('20:00:00');
  });

  it('uses the default 10–20 business window and pads its display to 08–22', () => {
    const defaults = normalizeCalendarWindowSettings();
    expect(defaults).toEqual({ slotMinTime: '10:00:00', slotMaxTime: '20:00:00' });
    expect(deriveCalendarDisplayWindow(defaults)).toEqual({
      slotMinTime: '08:00:00',
      slotMaxTime: '22:00:00',
    });
  });

  it('preserves saved 10–23 settings instead of replacing them with defaults', () => {
    const saved = { slotMinTime: '10:00:00', slotMaxTime: '23:00:00' };
    expect(normalizeCalendarWindowSettings(saved)).toEqual(saved);
  });

  it('validates half-hour aligned ranges where start is earlier than end', () => {
    expect(isValidCalendarWindowRange('10:00:00', '23:00:00')).toBe(true);
    expect(isValidCalendarWindowRange('10:30:00', '10:00:00')).toBe(false);
    expect(isValidCalendarWindowRange('10:15:00', '23:00:00')).toBe(false);
  });

  it('falls back to defaults when settings are missing or invalid', () => {
    expect(normalizeCalendarWindowSettings(undefined)).toEqual({
      slotMinTime: CALENDAR_SLOT_MIN_TIME,
      slotMaxTime: CALENDAR_SLOT_MAX_TIME,
    });
    expect(
      normalizeCalendarWindowSettings({
        slotMinTime: '10:15:00',
        slotMaxTime: '23:00:00',
      }),
    ).toEqual({
      slotMinTime: CALENDAR_SLOT_MIN_TIME,
      slotMaxTime: CALENDAR_SLOT_MAX_TIME,
    });
  });

  it('keeps valid provided settings unchanged', () => {
    expect(
      normalizeCalendarWindowSettings({
        slotMinTime: '11:00:00',
        slotMaxTime: '22:30:00',
      }),
    ).toEqual({
      slotMinTime: '11:00:00',
      slotMaxTime: '22:30:00',
    });
  });

  it('rejects equal start/end boundaries', () => {
    expect(isValidCalendarWindowRange('10:00:00', '10:00:00')).toBe(false);
  });

  it('converts values for time input and API payloads', () => {
    expect(toCalendarTimeInputValue('10:30:00')).toBe('10:30');
    expect(toCalendarTimePayloadValue('23:00')).toBe('23:00:00');
  });

  it.each([
    ['10:00:00', '20:00:00', '08:00:00', '22:00:00'],
    ['10:00:00', '23:00:00', '08:00:00', '24:00:00'],
    ['00:30:00', '23:30:00', '00:00:00', '24:00:00'],
    ['00:00:00', '02:00:00', '00:00:00', '04:00:00'],
    ['22:00:00', '23:30:00', '20:00:00', '24:00:00'],
  ])('derives clamped display bounds from %s–%s', (start, end, displayStart, displayEnd) => {
    expect(deriveCalendarDisplayWindow({ slotMinTime: start, slotMaxTime: end })).toEqual({
      slotMinTime: displayStart,
      slotMaxTime: displayEnd,
    });
  });

  it('keeps new-start validity on the business range, inclusive at opening and exclusive at closing', () => {
    const settings = { slotMinTime: '10:00:00', slotMaxTime: '23:00:00' };
    expect(isCalendarStartWithinBusinessHours(new Date(2026, 6, 30, 9, 59), settings)).toBe(false);
    expect(isCalendarStartWithinBusinessHours(new Date(2026, 6, 30, 10, 0), settings)).toBe(true);
    expect(isCalendarStartWithinBusinessHours(new Date(2026, 6, 30, 22, 30), settings)).toBe(true);
    expect(isCalendarStartWithinBusinessHours(new Date(2026, 6, 30, 23, 0), settings)).toBe(false);
    expect(isCalendarStartWithinBusinessHours(new Date(2026, 6, 30, 10, 0), null)).toBe(false);
  });
});
