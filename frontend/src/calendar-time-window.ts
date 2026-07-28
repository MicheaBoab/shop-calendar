// FullCalendar slotMaxTime is exclusive, so 23:00 hides anything starting at or after 11:00 PM.
export const CALENDAR_SLOT_MIN_TIME = '10:00:00';
export const CALENDAR_SLOT_MAX_TIME = '23:00:00';

export type CalendarWindowSettings = {
	slotMinTime: string;
	slotMaxTime: string;
};

const SLOT_TIME_PATTERN = /^([01]\d|2[0-3]):(00|30):00$/;

export const isValidCalendarWindowTime = (value: string) => {
	return SLOT_TIME_PATTERN.test(value);
};

export const isValidCalendarWindowRange = (slotMinTime: string, slotMaxTime: string) => {
	if (!isValidCalendarWindowTime(slotMinTime) || !isValidCalendarWindowTime(slotMaxTime)) {
		return false;
	}

	const startMinutes = toMinutes(slotMinTime);
	const endMinutes = toMinutes(slotMaxTime);
	return startMinutes < endMinutes;
};

export const normalizeCalendarWindowSettings = (
	settings?: Partial<CalendarWindowSettings> | null,
): CalendarWindowSettings => {
	const slotMinTime = settings?.slotMinTime ?? CALENDAR_SLOT_MIN_TIME;
	const slotMaxTime = settings?.slotMaxTime ?? CALENDAR_SLOT_MAX_TIME;

	if (!isValidCalendarWindowRange(slotMinTime, slotMaxTime)) {
		return {
			slotMinTime: CALENDAR_SLOT_MIN_TIME,
			slotMaxTime: CALENDAR_SLOT_MAX_TIME,
		};
	}

	return { slotMinTime, slotMaxTime };
};

export const toCalendarTimeInputValue = (slotTime: string) => {
	const [hours, minutes] = slotTime.split(':');
	return `${hours}:${minutes}`;
};

export const toCalendarTimePayloadValue = (inputTime: string) => {
	return `${inputTime}:00`;
};

const toMinutes = (value: string) => {
	const [hours, minutes] = value.split(':').map(Number);
	return hours * 60 + minutes;
};
