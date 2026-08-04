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

interface TimeInferenceWindow {
  startMinutes: number;
  endMinutes: number;
}

interface ParseFlexibleTimeOptions {
  inferenceWindow?: TimeInferenceWindow;
}

const isWithinInferenceWindow = (minutes: number, window: TimeInferenceWindow) => {
  if (window.startMinutes <= window.endMinutes) {
    return minutes >= window.startMinutes && minutes <= window.endMinutes;
  }

  return minutes >= window.startMinutes || minutes <= window.endMinutes;
};

const inferHoursByWindow = (rawHours: number, minutes: number, window: TimeInferenceWindow) => {
  if (rawHours < 1 || rawHours > 12) {
    return null;
  }

  const candidateHours = rawHours === 12 ? [12, 0] : [rawHours, rawHours + 12];
  const matched = candidateHours.find((hours) => {
    const totalMinutes = (hours * 60) + minutes;
    return isWithinInferenceWindow(totalMinutes, window);
  });

  return matched ?? null;
};

export const parseFlexibleTimeInput = (value: string, options?: ParseFlexibleTimeOptions): ParsedFlexibleTimeInput | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalizedInput = trimmed.replace(/：/g, ':');

  const normalize = (hours: number, minutes: number) => ({
    hours,
    minutes,
    normalized: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
  });

  const twentyFourHourMatch = /^(\d{1,2}):(\d{1,2})$/.exec(normalizedInput);
  if (twentyFourHourMatch) {
    const hours = Number.parseInt(twentyFourHourMatch[1], 10);
    const minutes = Number.parseInt(twentyFourHourMatch[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return null;
    }

    const inferredHours = options?.inferenceWindow
      ? inferHoursByWindow(hours, minutes, options.inferenceWindow)
      : null;

    if (inferredHours !== null) {
      return normalize(inferredHours, minutes);
    }

    return normalize(hours, minutes);
  }

  const hourOnlyMatch = /^(\d{1,2})$/.exec(normalizedInput);
  if (hourOnlyMatch) {
    const rawHours = Number.parseInt(hourOnlyMatch[1], 10);
    if (rawHours < 0 || rawHours > 23) {
      return null;
    }

    const inferredHours = options?.inferenceWindow
      ? inferHoursByWindow(rawHours, 0, options.inferenceWindow)
      : null;

    if (inferredHours !== null) {
      return normalize(inferredHours, 0);
    }

    return normalize(rawHours, 0);
  }

  return null;
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
