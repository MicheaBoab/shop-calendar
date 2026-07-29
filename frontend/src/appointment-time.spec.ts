import { describe, expect, it } from 'vitest';
import {
  buildDefaultAppointmentRange,
  computeDurationBetweenMinutes,
  computeEndFromDuration,
  crossesIntoNextDay,
  DEFAULT_APPOINTMENT_DURATION_MINUTES,
  formatDateForUsInput,
  formatWeekdayFromUsDateInput,
  isAlignedToMinuteGranularity,
  isLocalDateTimeInPast,
  parseFlexibleTimeInput,
  parseUsDateInput,
  parseDurationMinutes,
  shiftUsDateInputByDays,
} from './appointment-time';

describe('buildDefaultAppointmentRange', () => {
  it('uses 60 minutes by default', () => {
    const start = new Date('2026-07-28T09:00:00.000Z');
    const { startAt, endAt } = buildDefaultAppointmentRange(start);

    expect(startAt.toISOString()).toBe('2026-07-28T09:00:00.000Z');
    expect(endAt.toISOString()).toBe('2026-07-28T10:00:00.000Z');
    expect((endAt.getTime() - startAt.getTime()) / 60000).toBe(
      DEFAULT_APPOINTMENT_DURATION_MINUTES,
    );
  });
});

describe('isAlignedToMinuteGranularity', () => {
  it('accepts half-hour boundaries for appointment granularity', () => {
    const alignedStart = new Date('2026-07-28T09:00:00.000Z');
    const alignedMiddle = new Date('2026-07-28T09:30:00.000Z');

    expect(isAlignedToMinuteGranularity(alignedStart, 30)).toBe(true);
    expect(isAlignedToMinuteGranularity(alignedMiddle, 30)).toBe(true);
  });

  it('rejects non half-hour boundaries for appointment granularity', () => {
    const nonAligned = new Date('2026-07-28T09:15:00.000Z');

    expect(isAlignedToMinuteGranularity(nonAligned, 30)).toBe(false);
  });
});

describe('parseDurationMinutes', () => {
  it('parses positive integer duration strings', () => {
    expect(parseDurationMinutes('1')).toBe(1);
    expect(parseDurationMinutes('60')).toBe(60);
    expect(parseDurationMinutes(' 90 ')).toBe(90);
  });

  it('rejects missing or invalid duration values', () => {
    expect(parseDurationMinutes('')).toBeNull();
    expect(parseDurationMinutes('0')).toBeNull();
    expect(parseDurationMinutes('-30')).toBeNull();
    expect(parseDurationMinutes('30.5')).toBeNull();
    expect(parseDurationMinutes('abc')).toBeNull();
  });
});

describe('parseFlexibleTimeInput', () => {
  it('parses 24-hour HH:mm inputs', () => {
    expect(parseFlexibleTimeInput('09:30')).toEqual({ hours: 9, minutes: 30, normalized: '09:30' });
    expect(parseFlexibleTimeInput('23:05')).toEqual({ hours: 23, minutes: 5, normalized: '23:05' });
  });

  it('parses English AM/PM inputs', () => {
    expect(parseFlexibleTimeInput('2:30 PM')).toEqual({ hours: 14, minutes: 30, normalized: '14:30' });
    expect(parseFlexibleTimeInput('12:00 AM')).toEqual({ hours: 0, minutes: 0, normalized: '00:00' });
    expect(parseFlexibleTimeInput('12 PM')).toEqual({ hours: 12, minutes: 0, normalized: '12:00' });
  });

  it('parses Chinese 上午/下午 inputs', () => {
    expect(parseFlexibleTimeInput('上午9:15')).toEqual({ hours: 9, minutes: 15, normalized: '09:15' });
    expect(parseFlexibleTimeInput('下午2:30')).toEqual({ hours: 14, minutes: 30, normalized: '14:30' });
    expect(parseFlexibleTimeInput('下午12:05')).toEqual({ hours: 12, minutes: 5, normalized: '12:05' });
  });

  it('returns null for invalid values', () => {
    expect(parseFlexibleTimeInput('')).toBeNull();
    expect(parseFlexibleTimeInput('24:00')).toBeNull();
    expect(parseFlexibleTimeInput('13:00 PM')).toBeNull();
    expect(parseFlexibleTimeInput('上午0:30')).toBeNull();
    expect(parseFlexibleTimeInput('random')).toBeNull();
  });
});

describe('MM/DD/YYYY helpers', () => {
  it('formats a date as MM/DD/YYYY', () => {
    const value = new Date(2026, 6, 28, 9, 0, 0, 0);

    expect(formatDateForUsInput(value)).toBe('07/28/2026');
  });

  it('parses valid MM/DD/YYYY strings', () => {
    const parsed = parseUsDateInput('07/28/2026');

    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(6);
    expect(parsed?.getDate()).toBe(28);
  });

  it('rejects invalid MM/DD/YYYY strings', () => {
    expect(parseUsDateInput('2026-07-28')).toBeNull();
    expect(parseUsDateInput('7/8/2026')).toBeNull();
    expect(parseUsDateInput('13/01/2026')).toBeNull();
    expect(parseUsDateInput('02/30/2026')).toBeNull();
    expect(parseUsDateInput('abc')).toBeNull();
  });

  it('shifts valid MM/DD/YYYY by day offsets', () => {
    expect(shiftUsDateInputByDays('07/28/2026', -1)).toBe('07/27/2026');
    expect(shiftUsDateInputByDays('07/28/2026', 1)).toBe('07/29/2026');
    expect(shiftUsDateInputByDays('07/28/2026', 2)).toBe('07/30/2026');
  });

  it('falls back to the reference date when value is invalid', () => {
    const referenceDate = new Date(2026, 6, 28, 15, 30, 0, 0);

    expect(shiftUsDateInputByDays('invalid', 0, referenceDate)).toBe('07/28/2026');
    expect(shiftUsDateInputByDays('invalid', 1, referenceDate)).toBe('07/29/2026');
  });

  it('formats weekday labels from MM/DD/YYYY input', () => {
    expect(formatWeekdayFromUsDateInput('07/29/2026', 'short')).toBe('Wed');
    expect(formatWeekdayFromUsDateInput('07/29/2026', 'long')).toBe('Wednesday');
  });

  it('returns null weekday when MM/DD/YYYY input is invalid', () => {
    expect(formatWeekdayFromUsDateInput('invalid')).toBeNull();
    expect(formatWeekdayFromUsDateInput('2026-07-29')).toBeNull();
  });
});

describe('isLocalDateTimeInPast', () => {
  it('compares full local datetime to now/reference', () => {
    const reference = new Date(2026, 6, 28, 10, 0, 0, 0);

    expect(isLocalDateTimeInPast(new Date(2026, 6, 28, 9, 59, 59, 999), reference)).toBe(true);
    expect(isLocalDateTimeInPast(new Date(2026, 6, 28, 10, 0, 0, 0), reference)).toBe(false);
    expect(isLocalDateTimeInPast(new Date(2026, 6, 28, 10, 0, 0, 1), reference)).toBe(false);
  });

  it('treats date-only past values as past against a same-day later reference', () => {
    const reference = new Date(2026, 6, 28, 16, 0, 0, 0);

    expect(isLocalDateTimeInPast(new Date(2026, 6, 28, 0, 0, 0, 0), reference)).toBe(true);
  });
});

describe('computeEndFromDuration and cross-day checks', () => {
  it('computes end time by start + duration', () => {
    const startAt = new Date('2026-07-28T09:00:00.000Z');
    const endAt = computeEndFromDuration(startAt, 90);

    expect(endAt.toISOString()).toBe('2026-07-28T10:30:00.000Z');
    expect(computeDurationBetweenMinutes(startAt, endAt)).toBe(90);
  });

  it('detects end time crossing into the next day', () => {
    const startAt = new Date(2026, 6, 28, 23, 30, 0, 0);
    const endAt = computeEndFromDuration(startAt, 60);

    expect(crossesIntoNextDay(startAt, endAt)).toBe(true);
  });

  it('returns null for non-positive duration ranges', () => {
    const startAt = new Date('2026-07-28T09:00:00.000Z');
    const sameAsStart = new Date('2026-07-28T09:00:00.000Z');
    const earlier = new Date('2026-07-28T08:59:59.000Z');

    expect(computeDurationBetweenMinutes(startAt, sameAsStart)).toBeNull();
    expect(computeDurationBetweenMinutes(startAt, earlier)).toBeNull();
  });
});
