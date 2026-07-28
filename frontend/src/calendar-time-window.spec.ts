import { describe, expect, it } from 'vitest';
import {
  CALENDAR_SLOT_MAX_TIME,
  CALENDAR_SLOT_MIN_TIME,
  isValidCalendarWindowRange,
  normalizeCalendarWindowSettings,
  toCalendarTimeInputValue,
  toCalendarTimePayloadValue,
} from './calendar-time-window';

describe('calendar time window', () => {
  it('starts at 10:00 AM', () => {
    expect(CALENDAR_SLOT_MIN_TIME).toBe('10:00:00');
  });

  it('ends at 11:00 PM with FullCalendar exclusive max semantics', () => {
    expect(CALENDAR_SLOT_MAX_TIME).toBe('23:00:00');
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
});
