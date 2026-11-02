export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 60;
export const DEFAULT_APPOINTMENT_START_TIME = { hours: 9, minutes: 0 };

export const buildDefaultAppointmentRange = (
  startValue: Date | string,
  durationMinutes = DEFAULT_APPOINTMENT_DURATION_MINUTES,
) => {
  const startAt = new Date(startValue);
  const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

  return { startAt, endAt };
};

export const buildTodayDefaultAppointmentRange = (referenceDate: Date = new Date()) => {
  const startAt = new Date(referenceDate);
  startAt.setHours(DEFAULT_APPOINTMENT_START_TIME.hours, DEFAULT_APPOINTMENT_START_TIME.minutes, 0, 0);

  const endAt = new Date(startAt);
  endAt.setHours(
    DEFAULT_APPOINTMENT_START_TIME.hours + DEFAULT_APPOINTMENT_DURATION_MINUTES / 60,
    DEFAULT_APPOINTMENT_START_TIME.minutes,
    0,
    0,
  );

  return { startAt, endAt };
};

export const formatForDateTimeLocalInput = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

export const formatDateForUsInput = (value: Date) => {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const year = value.getFullYear();

  return `${month}/${day}/${year}`;
};

export const shiftUsDateInputByDays = (
  value: string,
  days: number,
  referenceDate: Date = new Date(),
) => {
  const parsed = parseUsDateInput(value);
  const baseDate = parsed ?? new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  baseDate.setDate(baseDate.getDate() + days);
  return formatDateForUsInput(baseDate);
};

export const parseUsDateInput = (value: string) => {
  const trimmed = value.trim();
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const month = Number.parseInt(match[1], 10);
  const day = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return null;
  }

  return parsed;
};

export const formatWeekdayFromUsDateInput = (
  value: string,
  style: 'short' | 'long' = 'short',
  locale: string = 'en-US',
) => {
  const parsed = parseUsDateInput(value);
  if (!parsed) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, { weekday: style }).format(parsed);
};

export const isLocalDateTimeInPast = (value: Date, referenceDate: Date = new Date()) => {
  return value.getTime() < referenceDate.getTime();
};

export const isAlignedToMinuteGranularity = (value: Date, granularityMinutes: number) => {
  return value.getMinutes() % granularityMinutes === 0 && value.getSeconds() === 0;
};

export const parseDurationMinutes = (value: string) => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const minutes = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(minutes) || minutes <= 0) {
    return null;
  }

  return minutes;
};

export interface ParsedFlexibleTimeInput {
  hours: number;
  minutes: number;
  normalized: string;
}

export interface AppointmentTimeWindow {
  startMinutes: number;
  endMinutes: number;
}

export type AppointmentTimeResolution =
  | { status: 'valid'; parsed: ParsedFlexibleTimeInput }
  | { status: 'invalid' | 'ambiguous' | 'outside-window' | 'window-unavailable' };

const isValidAppointmentTimeWindow = (window: AppointmentTimeWindow) => (
  Number.isInteger(window.startMinutes)
  && Number.isInteger(window.endMinutes)
  && window.startMinutes >= 0
  && window.endMinutes <= 24 * 60
  && window.startMinutes < window.endMinutes
);

const parseTwelveHourInput = (value: string) => {
  const trimmed = value.trim().replace(/：/g, ':');
  if (!trimmed) {
    return null;
  }

  let rawHours: number;
  let minutes: number;
  const colonMatch = /^(\d{1,2}):(\d{1,2})$/.exec(trimmed);
  if (colonMatch) {
    rawHours = Number.parseInt(colonMatch[1], 10);
    minutes = Number.parseInt(colonMatch[2], 10);
  } else if (/^\d{3,4}$/.test(trimmed)) {
    const hourDigits = trimmed.length === 3 ? 1 : 2;
    rawHours = Number.parseInt(trimmed.slice(0, hourDigits), 10);
    minutes = Number.parseInt(trimmed.slice(hourDigits), 10);
  } else if (/^\d{1,2}$/.test(trimmed)) {
    rawHours = Number.parseInt(trimmed, 10);
    minutes = 0;
  } else {
    return null;
  }

  if (rawHours < 1 || rawHours > 12 || minutes < 0 || minutes > 59) {
    return null;
  }

  return { rawHours, minutes };
};

export const formatAppointmentTimeInput = (value: Date) => {
  const displayHours = value.getHours() % 12 || 12;
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${displayHours}:${minutes}`;
};

export const resolveAppointmentTimeInput = (
  value: string,
  window?: AppointmentTimeWindow | null,
): AppointmentTimeResolution => {
  if (!window || !isValidAppointmentTimeWindow(window)) {
    return { status: 'window-unavailable' };
  }

  const parsedInput = parseTwelveHourInput(value);
  if (!parsedInput) {
    return { status: 'invalid' };
  }

  const candidateHours = parsedInput.rawHours === 12
    ? [12, 0]
    : [parsedInput.rawHours, parsedInput.rawHours + 12];
  const matchingHours = candidateHours.filter((hours) => {
    const totalMinutes = (hours * 60) + parsedInput.minutes;
    return totalMinutes >= window.startMinutes && totalMinutes < window.endMinutes;
  });

  if (matchingHours.length === 0) {
    return { status: 'outside-window' };
  }
  if (matchingHours.length > 1) {
    return { status: 'ambiguous' };
  }

  const hours = matchingHours[0];
  return {
    status: 'valid',
    parsed: {
      hours,
      minutes: parsedInput.minutes,
      normalized: `${hours % 12 || 12}:${String(parsedInput.minutes).padStart(2, '0')}`,
    },
  };
};

export const computeEndFromDuration = (startAt: Date, durationMinutes: number) => {
  return new Date(startAt.getTime() + durationMinutes * 60 * 1000);
};

export const crossesIntoNextDay = (startAt: Date, endAt: Date) => {
  return startAt.getFullYear() !== endAt.getFullYear()
    || startAt.getMonth() !== endAt.getMonth()
    || startAt.getDate() !== endAt.getDate();
};

export const computeDurationBetweenMinutes = (startAt: Date, endAt: Date) => {
  const deltaMs = endAt.getTime() - startAt.getTime();
  if (deltaMs <= 0) {
    return null;
  }

  return Math.round(deltaMs / 60000);
};
