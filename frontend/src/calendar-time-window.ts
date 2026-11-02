// FullCalendar slotMaxTime is exclusive, so 20:00 hides anything starting at or after 8:00 PM.
export const CALENDAR_SLOT_MIN_TIME = '10:00:00';
export const CALENDAR_SLOT_MAX_TIME = '20:00:00';

export type CalendarWindowSettings = {
	slotMinTime: string;
	slotMaxTime: string;
};

// Background presentation only; never use padded display bounds as business hours.
export const deriveCalendarBusinessHours = (settings: CalendarWindowSettings) => ({
	daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
	startTime: settings.slotMinTime,
	endTime: settings.slotMaxTime,
});

// Display-only bounds; 24:00 is a FullCalendar sentinel, never a business/input time.
export const deriveCalendarDisplayWindow = (
	settings: CalendarWindowSettings,
): CalendarWindowSettings => {
	const startMinutes = toMinutes(settings.slotMinTime);
	const endMinutes = toMinutes(settings.slotMaxTime);
	const displayStartMinutes = Math.max(0, startMinutes - 120);
	const displayEndMinutes = Math.min(24 * 60, endMinutes + 120);

	return {
		slotMinTime: formatClockTime(displayStartMinutes),
		slotMaxTime: formatClockTime(displayEndMinutes),
	};
};

export const isCalendarStartWithinBusinessHours = (
	start: Date,
	settings?: CalendarWindowSettings | null,
) => {
	if (!settings || !isValidCalendarWindowRange(settings.slotMinTime, settings.slotMaxTime)) {
		return false;
	}

	const startMinutes = toMinutes(settings.slotMinTime);
	const endMinutes = toMinutes(settings.slotMaxTime);
	const candidateMinutes = start.getHours() * 60 + start.getMinutes();
	return candidateMinutes >= startMinutes && candidateMinutes < endMinutes;
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

const formatClockTime = (minutes: number) => {
	const hours = Math.floor(minutes / 60);
	const remainder = minutes % 60;
	return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}:00`;
};
