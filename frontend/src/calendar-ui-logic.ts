import { formatDateForUsInput } from './appointment-time';

export type CalendarView = 'timeGridWeek' | 'timeGridThreeDay' | 'timeGridDay';

export const MOBILE_CALENDAR_BREAKPOINT_PX = 960;

export const getInitialCalendarViewForWidth = (viewportWidth?: number): CalendarView => {
  if (viewportWidth === undefined) {
    return 'timeGridWeek';
  }

  return viewportWidth <= MOBILE_CALENDAR_BREAKPOINT_PX ? 'timeGridThreeDay' : 'timeGridWeek';
};

export const getPrimaryCalendarControl = (isMobileCalendarLayout: boolean) => {
  return {
    view: isMobileCalendarLayout ? 'timeGridThreeDay' : 'timeGridWeek',
    label: isMobileCalendarLayout ? '3-day' : 'Week',
  } as const;
};

const formatTimeOnlyForInput = (value: Date) => {
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

export const applySlotClickToForm = <T extends { startDate: string; startTime: string }>(
  currentForm: T,
  clickedDate: Date,
): T => {
  return {
    ...currentForm,
    startDate: formatDateForUsInput(clickedDate),
    startTime: formatTimeOnlyForInput(clickedDate),
  };
};
