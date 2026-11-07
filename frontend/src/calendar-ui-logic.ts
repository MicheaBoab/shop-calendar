import { formatAppointmentTimeInput, formatDateForUsInput } from './appointment-time';

export type CalendarView = 'timeGridWeek' | 'timeGridThreeDay' | 'timeGridDay';

export const MOBILE_CALENDAR_BREAKPOINT_PX = 960;

export const getInitialCalendarViewForWidth = (_viewportWidth?: number): CalendarView => 'timeGridDay';

export const getPrimaryCalendarControl = (isMobileCalendarLayout: boolean) => {
  return {
    view: isMobileCalendarLayout ? 'timeGridThreeDay' : 'timeGridThreeDay',
    label: isMobileCalendarLayout ? '3-day' : '3-day',
  } as const;
};

export const applySlotClickToForm = <T extends { startDate: string; startTime: string }>(
  currentForm: T,
  clickedDate: Date,
): T => {
  return {
    ...currentForm,
    startDate: formatDateForUsInput(clickedDate),
    startTime: formatAppointmentTimeInput(clickedDate),
  };
};
