import { describe, expect, it } from 'vitest';
import {
  buildDefaultAppointmentRange,
  computeDurationBetweenMinutes,
  computeEndFromDuration,
  crossesIntoNextDay,
  DEFAULT_APPOINTMENT_DURATION_MINUTES,
  formatDateForUsInput,
  formatAppointmentTimeInput,
  formatWeekdayFromUsDateInput,
  isAlignedToMinuteGranularity,
  isLocalDateTimeInPast,
  parseUsDateInput,
  parseDurationMinutes,
  resolveAppointmentTimeInput,
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

describe('resolveAppointmentTimeInput', () => {
  const daytimeWindow = { startMinutes: 10 * 60, endMinutes: 20 * 60 };

  it.each([
    ['930', { startMinutes: 10 * 60, endMinutes: 23 * 60 }, 21, 30, '9:30'],
    ['0930', { startMinutes: 10 * 60, endMinutes: 23 * 60 }, 21, 30, '9:30'],
    ['230', daytimeWindow, 14, 30, '2:30'],
    ['1130', daytimeWindow, 11, 30, '11:30'],
    ['2:30', daytimeWindow, 14, 30, '2:30'],
    ['2', daytimeWindow, 14, 0, '2:00'],
    ['10', daytimeWindow, 10, 0, '10:00'],
    ['1030', daytimeWindow, 10, 30, '10:30'],
    ['02', daytimeWindow, 14, 0, '2:00'],
    ['2：30', daytimeWindow, 14, 30, '2:30'],
  ] as const)('resolves %s to the unique in-window time', (input, window, hours, minutes, normalized) => {
    expect(resolveAppointmentTimeInput(input, window)).toEqual({
      status: 'valid',
      parsed: { hours, minutes, normalized },
    });
  });

  it('resolves 12 as noon or midnight only when the business window uniquely selects it', () => {
    expect(resolveAppointmentTimeInput('12:30', daytimeWindow)).toEqual({
      status: 'valid',
      parsed: { hours: 12, minutes: 30, normalized: '12:30' },
    });
    expect(resolveAppointmentTimeInput('12', { startMinutes: 0, endMinutes: 10 * 60 })).toEqual({
      status: 'valid',
      parsed: { hours: 0, minutes: 0, normalized: '12:00' },
    });
  });

  it('reports ambiguous and unmatched candidates without guessing', () => {
    expect(resolveAppointmentTimeInput('9:30', { startMinutes: 8 * 60, endMinutes: 22 * 60 }))
      .toEqual({ status: 'ambiguous' });
    expect(resolveAppointmentTimeInput('9:30', daytimeWindow))
      .toEqual({ status: 'outside-window' });
  });

  it('uses an inclusive window start and exclusive end', () => {
    expect(resolveAppointmentTimeInput('10', daytimeWindow)).toEqual({
      status: 'valid',
      parsed: { hours: 10, minutes: 0, normalized: '10:00' },
    });
    expect(resolveAppointmentTimeInput('12', { startMinutes: 10 * 60, endMinutes: 12 * 60 }))
      .toEqual({ status: 'outside-window' });
  });

  it.each(['', '9300', '14', '14:30', '13:00', '0', '12:60', '9:99', '2:30 PM', '12 AM', '上午9:15', 'random'])(
    'rejects invalid 12-hour input %s',
    (input) => {
      expect(resolveAppointmentTimeInput(input, daytimeWindow)).toEqual({ status: 'invalid' });
    },
  );

  it('does not parse or guess without a loaded valid business window', () => {
    expect(resolveAppointmentTimeInput('2:30')).toEqual({ status: 'window-unavailable' });
    expect(resolveAppointmentTimeInput('2:30', { startMinutes: 20 * 60, endMinutes: 10 * 60 }))
      .toEqual({ status: 'window-unavailable' });
  });

  it('formats form times as 12-hour values without AM/PM', () => {
    expect(formatAppointmentTimeInput(new Date(2026, 6, 30, 0, 5))).toBe('12:05');
    expect(formatAppointmentTimeInput(new Date(2026, 6, 30, 9, 0))).toBe('9:00');
    expect(formatAppointmentTimeInput(new Date(2026, 6, 30, 14, 30))).toBe('2:30');
    expect(formatAppointmentTimeInput(new Date(2026, 6, 30, 23, 59))).toBe('11:59');
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
