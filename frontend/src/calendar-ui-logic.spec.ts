import { describe, expect, it } from 'vitest';
import {
  applySlotClickToForm,
  getInitialCalendarViewForWidth,
  getPrimaryCalendarControl,
} from './calendar-ui-logic';

describe('getInitialCalendarViewForWidth', () => {
  it('defaults to 3-day view when viewport width is not available', () => {
    expect(getInitialCalendarViewForWidth(undefined)).toBe('timeGridThreeDay');
  });

  it('uses 3-day view at or below mobile breakpoint', () => {
    expect(getInitialCalendarViewForWidth(960)).toBe('timeGridThreeDay');
  });

  it('uses 3-day view above mobile breakpoint', () => {
    expect(getInitialCalendarViewForWidth(1280)).toBe('timeGridThreeDay');
  });
});

describe('getPrimaryCalendarControl', () => {
  it('uses mobile label and view for mobile layout', () => {
    expect(getPrimaryCalendarControl(true)).toEqual({
      label: '3-day',
      view: 'timeGridThreeDay',
    });
  });

  it('uses desktop label and view for non-mobile layout', () => {
    expect(getPrimaryCalendarControl(false)).toEqual({
      label: '3-day',
      view: 'timeGridThreeDay',
    });
  });
});

describe('applySlotClickToForm', () => {
  it('fills start date/time from clicked slot and preserves other fields', () => {
    const currentForm = {
      employeeId: 'emp-1',
      startDate: '07/20/2026',
      startTime: '09:00',
      durationMinutes: '60',
      phone: '1234567890',
      price: '80.00',
      customerName: 'Chris',
      note: 'Color service',
    };

    const result = applySlotClickToForm(currentForm, new Date(2026, 6, 30, 14, 30, 0, 0));

    expect(result).toEqual({
      ...currentForm,
      startDate: '07/30/2026',
      startTime: '14:30',
    });
  });

  it('zero-pads time parts for single-digit hour/minute values', () => {
    const currentForm = {
      startDate: '07/20/2026',
      startTime: '09:00',
    };

    const result = applySlotClickToForm(currentForm, new Date(2026, 6, 30, 7, 5, 0, 0));

    expect(result.startDate).toBe('07/30/2026');
    expect(result.startTime).toBe('07:05');
  });
});
