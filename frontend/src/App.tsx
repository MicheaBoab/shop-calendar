import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { DateClickArg } from '@fullcalendar/interaction';
import type { DatesSetArg, EventContentArg, EventInput, EventMountArg } from '@fullcalendar/core';
import { resolveApiBaseUrl } from './api-base-url';
import {
  computeDurationBetweenMinutes,
  computeEndFromDuration,
  crossesIntoNextDay,
  DEFAULT_APPOINTMENT_DURATION_MINUTES,
  formatDateForUsInput,
  formatWeekdayFromUsDateInput,
  isLocalDateTimeInPast,
  type ParsedFlexibleTimeInput,
  parseFlexibleTimeInput,
  parseDurationMinutes,
  parseUsDateInput,
} from './appointment-time';
import {
  CALENDAR_SLOT_MAX_TIME,
  CALENDAR_SLOT_MIN_TIME,
  normalizeCalendarWindowSettings,
  toCalendarTimeInputValue,
  toCalendarTimePayloadValue,
} from './calendar-time-window';
import {
  formatPhoneForDisplay,
  normalizePhoneInput,
} from './phone-format';
import {
  applySlotClickToForm,
  getInitialCalendarViewForWidth,
  getPrimaryCalendarControl,
  MOBILE_CALENDAR_BREAKPOINT_PX,
} from './calendar-ui-logic';
import { useI18n } from './i18n/i18n';

interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  role: string;
  status: string;
}

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  user: UserSummary;
}

interface AppointmentRecord {
  id: string;
  employeeId: string;
  startAt: string;
  endAt: string;
  phone: string;
  price: string;
  customerName?: string | null;
  note?: string | null;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  role: string;
  status: string;
  color?: string;
}

interface AppointmentFormState {
  employeeId: string;
  startDate: string;
  startTime: string;
  durationMinutes: string;
  phone: string;
  price: string;
  customerName: string;
  note: string;
}

interface CalendarWindowResponse {
  slotMinTime: string;
  slotMaxTime: string;
}

interface CalendarWindowFormState {
  slotMinTime: string;
  slotMaxTime: string;
}

interface AdminCreateUserFormState {
  username: string;
  password: string;
  confirmPassword: string;
  displayName: string;
}

interface AuditLogRecord {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  beforePayload: unknown;
  afterPayload: unknown;
  actor: {
    id: string;
    username: string;
    displayName: string;
    role: string;
  };
}

interface AuditLogsResponse {
  page: number;
  limit: number;
  total: number;
  items: AuditLogRecord[];
}

type MessageTone = 'info' | 'success' | 'error';
type UserStatusValue = 'ACTIVE' | 'INACTIVE';
type AdminPanel = 'calendar' | 'overview' | 'admin' | 'logs';
type TodayAgendaMode = 'time' | 'employee';
type CalendarView = 'timeGridWeek' | 'timeGridThreeDay' | 'timeGridDay';
const DURATION_QUICK_SELECT_MINUTES = [30, 60, 75, 90, 120] as const;

const API_BASE_URL = resolveApiBaseUrl({
  envBaseUrl: import.meta.env.VITE_API_BASE_URL,
  hostname: typeof window !== 'undefined' ? window.location.hostname : undefined,
  protocol: typeof window !== 'undefined' ? window.location.protocol : undefined,
});
const AUTH_STORAGE_KEY = 'shop-calendar-auth';

const isAuthResponse = (value: unknown): value is AuthResponse => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const data = value as Partial<AuthResponse>;
  if (typeof data.accessToken !== 'string' || typeof data.refreshToken !== 'string' || typeof data.tokenType !== 'string') {
    return false;
  }

  const user = data.user as Partial<UserSummary> | undefined;
  return Boolean(
    user
    && typeof user.id === 'string'
    && typeof user.username === 'string'
    && typeof user.displayName === 'string'
    && typeof user.role === 'string'
    && typeof user.status === 'string',
  );
};

const readStoredAuth = (): AuthResponse | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isAuthResponse(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const persistAuth = (auth: AuthResponse | null) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (auth) {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
    return;
  }

  window.localStorage.removeItem(AUTH_STORAGE_KEY);
};

const createInitialForm = (): AppointmentFormState => {
  const today = new Date();
  return {
    employeeId: '',
    startDate: formatDateForUsInput(today),
    startTime: '',
    durationMinutes: String(DEFAULT_APPOINTMENT_DURATION_MINUTES),
    phone: '',
    price: '',
    customerName: '',
    note: '',
  };
};
const PENDING_EMPLOYEE_USERNAME = 'pending_assignment';
const PENDING_EMPLOYEE_COLOR = '#64748b';
const CALENDAR_EVENT_BACKGROUND_DARK = '#0f172a';
const CALENDAR_EVENT_TEXT_LIGHT = '#f8fafc';
const CALENDAR_EVENT_EMPLOYEE_TINT = 28;
const CALENDAR_PENDING_EVENT_TINT = 20;

const hashStringToHue = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash) % 360;
};

const colorFromStableIdentifier = (identifier: string) => {
  const hue = hashStringToHue(identifier);
  return `hsl(${hue} 70% 56%)`;
};

const isActiveStatus = (status: string) => status.trim().toUpperCase() === 'ACTIVE';

const formatAppointmentWindow = (startAt: string, endAt: string, locale: string) => {
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const start = new Date(startAt);
  const end = new Date(endAt);

  if (isSameLocalDate(start, end)) {
    return `${formatDateOnlyForDisplay(start, locale)} ${timeFormatter.format(start)} - ${timeFormatter.format(end)}`;
  }

  return `${formatDateOnlyForDisplay(start, locale)} ${timeFormatter.format(start)} - ${formatDateOnlyForDisplay(end, locale)} ${timeFormatter.format(end)}`;
};

const formatDateOnlyForDisplay = (value: Date, locale: string) => {
  const formatter = new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
  return formatter.format(value);
};

const isSameLocalDate = (left: Date, right: Date) => {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
};

const formatTimeOnlyForInput = (value: Date) => {
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

const parseClockToMinutes = (value: string) => {
  const match = /^(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) {
    return null;
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return (hours * 60) + minutes;
};

const buildLocalDateTime = (
  dateValue: string,
  timeValue: string,
  parseTime: (value: string) => ParsedFlexibleTimeInput | null = parseFlexibleTimeInput,
) => {
  if (!dateValue || !timeValue) {
    return null;
  }

  const parsedDate = parseUsDateInput(dateValue);
  if (!parsedDate) {
    return null;
  }

  const parsedTime = parseTime(timeValue);
  if (!parsedTime) {
    return null;
  }

  const parsed = new Date(
    parsedDate.getFullYear(),
    parsedDate.getMonth(),
    parsedDate.getDate(),
    parsedTime.hours,
    parsedTime.minutes,
    0,
    0,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatTimeOnly = (value: string, locale: string) => {
  const formatter = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(new Date(value));
};

const formatAgendaTimeRange = (startAt: string, endAt: string, locale: string) => {
  const formatter = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${formatter.format(new Date(startAt))} - ${formatter.format(new Date(endAt))}`;
};

const formatDateTimeForPreview = (value: Date, locale: string) => {
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${formatDateOnlyForDisplay(value, locale)} ${timeFormatter.format(value)}`;
};

const getInitialCalendarView = (): CalendarView => {
  if (typeof window === 'undefined') {
    return getInitialCalendarViewForWidth(undefined);
  }
  return getInitialCalendarViewForWidth(window.innerWidth);
};

const formatRelativeToToday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatDateForUsInput(date);
};

const incrementUsDateInputByDays = (input: string, days: number) => {
  const parsed = parseUsDateInput(input);
  const base = parsed ?? new Date();
  const next = new Date(base);
  next.setDate(base.getDate() + days);
  return formatDateForUsInput(next);
};

const EVENT_NOTE_KEYS = ['note', 'remark', 'description', 'memo', 'comment'] as const;

const createInitialAdminCreateUserForm = (): AdminCreateUserFormState => ({
  username: '',
  password: '',
  confirmPassword: '',
  displayName: '',
});

const readEventNoteFromRecord = (record: Record<string, unknown> | null | undefined) => {
  if (!record) {
    return null;
  }

  for (const key of EVENT_NOTE_KEYS) {
    const candidate = record[key];
    if (typeof candidate === 'string') {
      const normalized = candidate.trim();
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
};

const resolveCalendarEventNote = (eventArg: EventContentArg['event']) => {
  const eventRecord = eventArg as unknown as Record<string, unknown>;
  const extendedPropsRecord = eventArg.extendedProps as unknown as Record<string, unknown> | undefined;

  return readEventNoteFromRecord(extendedPropsRecord) ?? readEventNoteFromRecord(eventRecord);
};

const NOTE_TOOLTIP_LONG_PRESS_DELAY_MS = 450;
const NOTE_TOOLTIP_MOVE_CANCEL_THRESHOLD_PX = 10;
type CalendarNoteTooltipCleanup = () => void;

const isCalendarNoteTruncated = (element: HTMLElement) => {
  const horizontalOverflow = element.scrollWidth - element.clientWidth > 1;
  const verticalOverflow = element.scrollHeight - element.clientHeight > 1;
  return horizontalOverflow || verticalOverflow;
};

const bindCalendarEventNoteTooltip = (noteElement: HTMLElement, noteText: string): CalendarNoteTooltipCleanup => {
  let tooltipLayerElement: HTMLDivElement | null = null;
  let tooltipCloseButton: HTMLButtonElement | null = null;
  let tooltipBackdropElement: HTMLButtonElement | null = null;
  let pressTimerId: number | null = null;
  let suppressClickToggle = false;
  let touchStartPoint: { x: number; y: number } | null = null;

  const isMobilePointerMode = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(hover: none), (pointer: coarse)').matches;
  };

  const clearPressTimer = () => {
    if (pressTimerId !== null) {
      window.clearTimeout(pressTimerId);
      pressTimerId = null;
    }
  };

  const hideMobileTooltip = () => {
    if (!tooltipLayerElement) {
      return;
    }
    tooltipCloseButton?.removeEventListener('click', hideMobileTooltip);
    tooltipBackdropElement?.removeEventListener('click', hideMobileTooltip);
    tooltipLayerElement.remove();
    tooltipLayerElement = null;
    tooltipCloseButton = null;
    tooltipBackdropElement = null;
  };

  const ensureTooltipLayer = () => {
    if (tooltipLayerElement) {
      return tooltipLayerElement;
    }

    const layer = document.createElement('div');
    layer.className = 'calendar-note-tooltip-layer';

    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'calendar-note-tooltip-backdrop';
    backdrop.setAttribute('aria-label', 'Close note details');

    const dialog = document.createElement('div');
    dialog.className = 'calendar-note-tooltip';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'false');

    const content = document.createElement('div');
    content.className = 'calendar-note-tooltip-content';
    content.textContent = noteText;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'calendar-note-tooltip-close';
    closeButton.textContent = 'Close';

    dialog.appendChild(content);
    dialog.appendChild(closeButton);
    layer.appendChild(backdrop);
    layer.appendChild(dialog);
    document.body.appendChild(layer);

    closeButton.addEventListener('click', hideMobileTooltip);
    backdrop.addEventListener('click', hideMobileTooltip);

    tooltipLayerElement = layer;
    tooltipCloseButton = closeButton;
    tooltipBackdropElement = backdrop;

    return layer;
  };

  const refreshDesktopTooltip = () => {
    if (isCalendarNoteTruncated(noteElement)) {
      noteElement.setAttribute('title', noteText);
      return;
    }
    noteElement.removeAttribute('title');
    hideMobileTooltip();
  };

  const showMobileTooltip = () => {
    if (!isMobilePointerMode() || !isCalendarNoteTruncated(noteElement)) {
      return false;
    }

    ensureTooltipLayer();
    return true;
  };

  const onTouchStart = (event: TouchEvent) => {
    if (!isMobilePointerMode() || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    touchStartPoint = { x: touch.clientX, y: touch.clientY };
    clearPressTimer();
    pressTimerId = window.setTimeout(() => {
      suppressClickToggle = showMobileTooltip();
    }, NOTE_TOOLTIP_LONG_PRESS_DELAY_MS);
  };

  const onTouchMove = (event: TouchEvent) => {
    if (!isMobilePointerMode() || event.touches.length !== 1 || !touchStartPoint) {
      return;
    }

    const touch = event.touches[0];
    const movedDistance = Math.hypot(touch.clientX - touchStartPoint.x, touch.clientY - touchStartPoint.y);

    if (movedDistance > NOTE_TOOLTIP_MOVE_CANCEL_THRESHOLD_PX) {
      clearPressTimer();
    }
  };

  const onTouchEndOrCancel = () => {
    clearPressTimer();
    touchStartPoint = null;
  };

  const onClick = () => {
    if (!isMobilePointerMode() || !isCalendarNoteTruncated(noteElement)) {
      return;
    }

    if (suppressClickToggle) {
      suppressClickToggle = false;
      return;
    }

    if (tooltipLayerElement) {
      hideMobileTooltip();
      return;
    }

    showMobileTooltip();
  };

  const onWindowResize = () => {
    refreshDesktopTooltip();
  };

  const resizeObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => {
      refreshDesktopTooltip();
    })
    : null;

  noteElement.addEventListener('mouseenter', refreshDesktopTooltip);
  noteElement.addEventListener('focus', refreshDesktopTooltip);
  noteElement.addEventListener('click', onClick);
  noteElement.addEventListener('touchstart', onTouchStart, { passive: true });
  noteElement.addEventListener('touchmove', onTouchMove, { passive: true });
  noteElement.addEventListener('touchend', onTouchEndOrCancel, { passive: true });
  noteElement.addEventListener('touchcancel', onTouchEndOrCancel, { passive: true });
  window.addEventListener('resize', onWindowResize);
  resizeObserver?.observe(noteElement);

  requestAnimationFrame(refreshDesktopTooltip);

  return () => {
    clearPressTimer();
    hideMobileTooltip();
    noteElement.removeEventListener('mouseenter', refreshDesktopTooltip);
    noteElement.removeEventListener('focus', refreshDesktopTooltip);
    noteElement.removeEventListener('click', onClick);
    noteElement.removeEventListener('touchstart', onTouchStart);
    noteElement.removeEventListener('touchmove', onTouchMove);
    noteElement.removeEventListener('touchend', onTouchEndOrCancel);
    noteElement.removeEventListener('touchcancel', onTouchEndOrCancel);
    window.removeEventListener('resize', onWindowResize);
    resizeObserver?.disconnect();
  };
};

function App() {
  const { locale, setLocale, t } = useI18n();
  const initialStoredAuthRef = useRef<AuthResponse | null>(readStoredAuth());
  const [auth, setAuth] = useState<AuthResponse | null>(() => initialStoredAuthRef.current);
  const [isAuthBootstrapping, setIsAuthBootstrapping] = useState(() => initialStoredAuthRef.current !== null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [form, setForm] = useState<AppointmentFormState>(() => createInitialForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [messageTone, setMessageTone] = useState<MessageTone>('info');
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [adminCreateUserForm, setAdminCreateUserForm] = useState<AdminCreateUserFormState>(() => createInitialAdminCreateUserForm());
  const [passwordResetTargetUserId, setPasswordResetTargetUserId] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [isMobileCalendarLayout, setIsMobileCalendarLayout] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth <= MOBILE_CALENDAR_BREAKPOINT_PX : false
  ));
  const [calendarView, setCalendarView] = useState<CalendarView>(() => getInitialCalendarView());
  const [adminPanel, setAdminPanel] = useState<AdminPanel>('calendar');
  const [calendarWindow, setCalendarWindow] = useState<CalendarWindowResponse>(() => ({
    slotMinTime: CALENDAR_SLOT_MIN_TIME,
    slotMaxTime: CALENDAR_SLOT_MAX_TIME,
  }));
  const [calendarWindowForm, setCalendarWindowForm] = useState<CalendarWindowFormState>(() => ({
    slotMinTime: toCalendarTimeInputValue(CALENDAR_SLOT_MIN_TIME),
    slotMaxTime: toCalendarTimeInputValue(CALENDAR_SLOT_MAX_TIME),
  }));
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [auditLogsTotal, setAuditLogsTotal] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [todayAgendaMode, setTodayAgendaMode] = useState<TodayAgendaMode>('time');
  const calendarRef = useRef<FullCalendar | null>(null);
  const calendarEventTooltipCleanupRef = useRef<Map<HTMLElement, CalendarNoteTooltipCleanup>>(new Map());
  const sseConnectionRef = useRef<EventSource | null>(null);
  const refreshDebounceRef = useRef<number | null>(null);
  const authRef = useRef<AuthResponse | null>(initialStoredAuthRef.current);
  const refreshInFlightRef = useRef<Promise<AuthResponse | null> | null>(null);

  const calendarDayHeaderWeekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'short' }),
    [locale],
  );
  const calendarDayHeaderDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }),
    [locale],
  );

  useEffect(() => {
    const className = 'theme-dark';
    document.body.classList.add(className);

    return () => {
      document.body.classList.remove(className);
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const cleanup of calendarEventTooltipCleanupRef.current.values()) {
        cleanup();
      }
      calendarEventTooltipCleanupRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (auth?.user.role !== 'ADMIN') {
      setAdminPanel('calendar');
    }
  }, [auth]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleResize = () => {
      setIsMobileCalendarLayout(window.innerWidth <= MOBILE_CALENDAR_BREAKPOINT_PX);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    setCalendarView((current) => {
      if (current === 'timeGridDay') {
        return current;
      }

      return isMobileCalendarLayout ? 'timeGridThreeDay' : 'timeGridThreeDay';
    });
  }, [isMobileCalendarLayout]);

  const employeeOptions = useMemo(
    () => users.filter((user) => isActiveStatus(user.status) && user.role === 'EMPLOYEE'),
    [users],
  );

  const pendingEmployee = useMemo(
    () => employeeOptions.find((user) => user.username === PENDING_EMPLOYEE_USERNAME) ?? null,
    [employeeOptions],
  );

  const assignableEmployeeOptions = useMemo(
    () => employeeOptions.filter((user) => user.username !== PENDING_EMPLOYEE_USERNAME),
    [employeeOptions],
  );

  const employeeColorMap = useMemo(() => {
    const colorMap = new Map<string, string>();

    for (const employee of employeeOptions) {
      if (employee.username === PENDING_EMPLOYEE_USERNAME) {
        colorMap.set(employee.id, PENDING_EMPLOYEE_COLOR);
        continue;
      }

      const configuredColor = employee.color?.trim();
      const stableIdentifier = employee.id.trim() || employee.username.trim() || employee.displayName.trim() || 'employee-fallback';
      colorMap.set(employee.id, configuredColor || colorFromStableIdentifier(stableIdentifier));
    }

    return colorMap;
  }, [employeeOptions]);

  const employeeNameMap = useMemo(() => {
    const nameMap = new Map<string, string>();

    for (const user of users) {
      const normalizedDisplayName = user.username === PENDING_EMPLOYEE_USERNAME
        ? t('editor.pendingAssignment')
        : user.displayName;
      nameMap.set(user.id, normalizedDisplayName);
    }

    return nameMap;
  }, [users, t]);

  const getEmployeeColor = useCallback((employeeId: string) => {
    if (!employeeId.trim()) {
      return PENDING_EMPLOYEE_COLOR;
    }

    const knownColor = employeeColorMap.get(employeeId);
    if (knownColor) {
      return knownColor;
    }

    return colorFromStableIdentifier(employeeId);
  }, [employeeColorMap]);

  const getEmployeeName = useCallback((employeeId: string) => {
    return employeeNameMap.get(employeeId) ?? t('overview.employeeFallback');
  }, [employeeNameMap, t]);

  const setNotice = (text: string, tone: MessageTone = 'info') => {
    setMessage(text);
    setMessageTone(tone);
  };

  const applyAuthState = useCallback((nextAuth: AuthResponse | null) => {
    authRef.current = nextAuth;
    setAuth(nextAuth);
    persistAuth(nextAuth);
  }, []);

  const clearAuthState = useCallback(() => {
    applyAuthState(null);
    setUsers([]);
    setAppointments([]);
    setForm(createInitialForm());
    setEditingId(null);
    setAuditLogs([]);
    setAuditLogsTotal(0);
    setPasswordResetTargetUserId('');
  }, [applyAuthState]);

  const forceLogoutWithNotice = useCallback((notice: string) => {
    clearAuthState();
    setNotice(notice, 'error');
  }, [clearAuthState]);

  const parseStartTimeInput = useCallback((value: string) => {
    const startMinutes = parseClockToMinutes(calendarWindow.slotMinTime);
    const endMinutes = parseClockToMinutes(calendarWindow.slotMaxTime);

    if (startMinutes === null || endMinutes === null) {
      return parseFlexibleTimeInput(value);
    }

    return parseFlexibleTimeInput(value, {
      inferenceWindow: {
        startMinutes,
        endMinutes,
      },
    });
  }, [calendarWindow.slotMinTime, calendarWindow.slotMaxTime]);

  const refreshAuthSession = useCallback(async (refreshToken: string, showExpiredNotice = true) => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const run = (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        const text = await response.text();
        let parsed: unknown = null;
        if (text) {
          try {
            parsed = JSON.parse(text) as unknown;
          } catch {
            parsed = null;
          }
        }

        if (!response.ok || !isAuthResponse(parsed)) {
          throw new Error(t('notices.sessionExpired'));
        }

        applyAuthState(parsed);
        return parsed;
      } catch {
        clearAuthState();
        if (showExpiredNotice) {
          setNotice(t('notices.sessionExpired'), 'error');
        }
        return null;
      } finally {
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = run;
    return run;
  }, [applyAuthState, clearAuthState, t]);

  useEffect(() => {
    const storedAuth = initialStoredAuthRef.current;
    if (!storedAuth?.refreshToken) {
      setIsAuthBootstrapping(false);
      return;
    }

    let active = true;
    void refreshAuthSession(storedAuth.refreshToken, false)
      .finally(() => {
        if (active) {
          setIsAuthBootstrapping(false);
        }
      });

    return () => {
      active = false;
    };
  }, [refreshAuthSession]);

  const getDisplayError = (error: unknown, fallback: string) => {
    if (error instanceof Error && /conflict|already|overlap/i.test(error.message)) {
      return t('errors.conflict');
    }
    return error instanceof Error ? error.message : fallback;
  };

  const fetchJson = async (path: string, init?: RequestInit, canRetry = true): Promise<any> => {
    const headers: Record<string, string> = {};
    if (init?.body && !(init.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    if (authRef.current?.accessToken) {
      headers.Authorization = `Bearer ${authRef.current.accessToken}`;
    }
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
    });
    const text = await response.text();
    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { message: text };
      }
    }
    if (response.status === 401 && canRetry) {
      const refreshToken = authRef.current?.refreshToken;
      if (refreshToken) {
        const refreshed = await refreshAuthSession(refreshToken);
        if (refreshed?.accessToken) {
          return fetchJson(path, init, false);
        }
      } else {
        forceLogoutWithNotice(t('notices.sessionExpired'));
      }

      throw new Error(t('notices.sessionExpired'));
    }

    if (!response.ok) {
      throw new Error(parsed?.message ?? t('errors.requestFailed'));
    }
    return parsed;
  };

  const loadUsers = useCallback(async () => {
    const data = await fetchJson('/users');
    setUsers(data);
  }, [auth?.accessToken]);

  const loadAppointments = useCallback(async () => {
    const data = await fetchJson('/appointments');
    setAppointments(data);
  }, [auth?.accessToken]);

  const loadCalendarWindow = useCallback(async () => {
    const data = await fetchJson('/system-settings/calendar-window');
    const normalized = normalizeCalendarWindowSettings(data);

    setCalendarWindow(normalized);
    setCalendarWindowForm({
      slotMinTime: toCalendarTimeInputValue(normalized.slotMinTime),
      slotMaxTime: toCalendarTimeInputValue(normalized.slotMaxTime),
    });
  }, [auth?.accessToken]);

  const loadAuditLogs = useCallback(async () => {
    const data = await fetchJson('/audit/logs?page=1&limit=100') as AuditLogsResponse;
    setAuditLogs(data.items ?? []);
    setAuditLogsTotal(data.total ?? 0);
  }, [auth?.accessToken]);

  const scheduleAppointmentsRefresh = useCallback(() => {
    if (refreshDebounceRef.current) {
      window.clearTimeout(refreshDebounceRef.current);
    }

    refreshDebounceRef.current = window.setTimeout(() => {
      void loadAppointments();
    }, 200);
  }, [loadAppointments]);

  useEffect(() => {
    if (!auth) {
      setCalendarWindow({
        slotMinTime: CALENDAR_SLOT_MIN_TIME,
        slotMaxTime: CALENDAR_SLOT_MAX_TIME,
      });
      setCalendarWindowForm({
        slotMinTime: toCalendarTimeInputValue(CALENDAR_SLOT_MIN_TIME),
        slotMaxTime: toCalendarTimeInputValue(CALENDAR_SLOT_MAX_TIME),
      });
      return;
    }
    void (async () => {
      const results = await Promise.allSettled([loadUsers(), loadAppointments(), loadCalendarWindow()]);
      const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
      if (rejected) {
        setNotice(getDisplayError(rejected.reason, t('notices.failedLoadCalendar')), 'error');
      }
    })();
  }, [auth, loadAppointments, loadCalendarWindow, loadUsers]);

  useEffect(() => {
    if (!auth?.accessToken) {
      if (sseConnectionRef.current) {
        sseConnectionRef.current.close();
        sseConnectionRef.current = null;
      }
      return;
    }

    const streamUrl = `${API_BASE_URL}/appointments/stream?accessToken=${encodeURIComponent(auth.accessToken)}`;
    const eventSource = new EventSource(streamUrl);
    sseConnectionRef.current = eventSource;

    const onChanged = () => {
      scheduleAppointmentsRefresh();
    };

    eventSource.addEventListener('appointments.changed', onChanged as EventListener);

    return () => {
      eventSource.removeEventListener('appointments.changed', onChanged as EventListener);
      eventSource.close();
      if (sseConnectionRef.current === eventSource) {
        sseConnectionRef.current = null;
      }
      if (refreshDebounceRef.current) {
        window.clearTimeout(refreshDebounceRef.current);
        refreshDebounceRef.current = null;
      }
    };
  }, [auth?.accessToken, scheduleAppointmentsRefresh]);

  useEffect(() => {
    if (!auth || auth.user.role !== 'ADMIN' || adminPanel !== 'logs') {
      return;
    }

    setLogsLoading(true);
    void loadAuditLogs()
      .catch((error) => {
        setNotice(getDisplayError(error, t('notices.failedLoadLogs')), 'error');
      })
      .finally(() => {
        setLogsLoading(false);
      });
  }, [auth, adminPanel, loadAuditLogs]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message ?? t('notices.loginFailed'));
      }
      if (!isAuthResponse(data)) {
        throw new Error(t('notices.loginFailed'));
      }

      applyAuthState(data);
      setNotice(t('notices.signedInAs', { displayName: data.user.displayName }), 'success');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('notices.loginFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    clearAuthState();
    setNotice(t('notices.signedOut'), 'info');
  };

  const handleCreateOrUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth) {
      return;
    }

    const selectedEmployeeId = form.employeeId || pendingEmployee?.id || '';

    if (!selectedEmployeeId || !form.startDate || !form.startTime || !form.phone) {
      setNotice(t('notices.fillRequired'), 'error');
      return;
    }

    if (!form.durationMinutes.trim()) {
      setNotice(t('notices.durationRequired'), 'error');
      return;
    }

    const durationMinutes = parseDurationMinutes(form.durationMinutes);
    if (durationMinutes === null) {
      setNotice(t('notices.durationInvalid'), 'error');
      return;
    }

    if (!/^\d{10}$/.test(form.phone)) {
      setNotice(t('notices.phoneInvalid'), 'error');
      return;
    }

    if (form.price.trim() && !/^\d+(\.\d{2})$/.test(form.price)) {
      setNotice(t('notices.priceInvalid'), 'error');
      return;
    }

    const startAt = buildLocalDateTime(form.startDate, form.startTime, parseStartTimeInput);
    if (form.startDate && !parseUsDateInput(form.startDate)) {
      setNotice(t('notices.startDateInvalid'), 'error');
      return;
    }

    if (!startAt) {
      setNotice(t('notices.startDateTimeInvalid'), 'error');
      return;
    }

    if (isLocalDateTimeInPast(startAt)) {
      setNotice(t('notices.startInPast'), 'error');
      return;
    }

    const endAt = computeEndFromDuration(startAt, durationMinutes);
    if (crossesIntoNextDay(startAt, endAt)) {
      setNotice(t('notices.endNextDay'), 'error');
      return;
    }

    if (durationMinutes > 180) {
      const confirmed = window.confirm(t('confirm.longDuration'));
      if (!confirmed) {
        setNotice(t('notices.saveCancelled'), 'info');
        return;
      }
    }

    if (startAt >= endAt) {
      setNotice(t('notices.rangeInvalid'), 'error');
      return;
    }

    setLoading(true);
    setNotice('');
    try {
      const payload = {
        employeeId: selectedEmployeeId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        phone: form.phone,
        price: form.price.trim() ? form.price : undefined,
        customerName: form.customerName || undefined,
        note: form.note || undefined,
        createdById: auth.user.id,
        updatedById: auth.user.id,
      };

      if (editingId) {
        await fetchJson(`/appointments/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setNotice(t('notices.appointmentUpdated'), 'success');
      } else {
        await fetchJson('/appointments', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setNotice(t('notices.appointmentCreated'), 'success');
      }
      setForm(createInitialForm());
      setEditingId(null);
      await loadAppointments();
    } catch (error) {
      setNotice(getDisplayError(error, t('notices.saveFailed')), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (appointment: AppointmentRecord) => {
    setEditingId(appointment.id);
    setNotice(t('notices.editingExisting'), 'info');
    const startAt = new Date(appointment.startAt);
    const endAt = new Date(appointment.endAt);
    setForm({
      employeeId: pendingEmployee && appointment.employeeId === pendingEmployee.id ? '' : appointment.employeeId,
      startDate: formatDateForUsInput(startAt),
      startTime: formatTimeOnlyForInput(startAt),
      durationMinutes: String(
        computeDurationBetweenMinutes(startAt, endAt) ?? DEFAULT_APPOINTMENT_DURATION_MINUTES,
      ),
      phone: appointment.phone,
      price: appointment.price,
      customerName: appointment.customerName ?? '',
      note: appointment.note ?? '',
    });
  };

  const handleDelete = async (appointmentId: string) => {
    if (!auth) {
      return;
    }

    const confirmed = window.confirm(auth.user.role === 'ADMIN' ? t('confirm.deleteAppointmentAdmin') : t('confirm.deleteAppointmentEmployee'));
    if (!confirmed) {
      setNotice(t('notices.actionCancelled'), 'info');
      return;
    }

    setLoading(true);
    try {
      await fetchJson(`/appointments/${appointmentId}`, {
        method: 'DELETE',
      });
      if (editingId === appointmentId) {
        setEditingId(null);
        setForm(createInitialForm());
      }
      setNotice(auth.user.role === 'ADMIN' ? t('notices.appointmentDeleted') : t('notices.appointmentCancelled'), 'success');
      await loadAppointments();
    } catch (error) {
      setNotice(getDisplayError(error, t('notices.deleteFailed')), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminCreateUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth || auth.user.role !== 'ADMIN') {
      return;
    }
    const username = adminCreateUserForm.username.trim();
    const password = adminCreateUserForm.password;
    const confirmPassword = adminCreateUserForm.confirmPassword;
    const displayName = adminCreateUserForm.displayName.trim() || username;
    const role = 'EMPLOYEE';

    if (password !== confirmPassword) {
      setNotice(t('notices.passwordMismatch'), 'error');
      return;
    }

    setLoading(true);
    try {
      await fetchJson('/users', {
        method: 'POST',
        body: JSON.stringify({ username, password, displayName, role }),
      });
      setNotice(t('notices.employeeCreated'), 'success');
      await loadUsers();
      setAdminCreateUserForm(createInitialAdminCreateUserForm());
    } catch (error) {
      setNotice(getDisplayError(error, t('notices.userCreationFailed')), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminResetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth || auth.user.role !== 'ADMIN') {
      return;
    }

    const formElement = event.currentTarget as HTMLFormElement;
    const formData = new FormData(formElement);
    const targetUserId = String(formData.get('targetUserId') ?? '').trim();
    const newPassword = String(formData.get('newPassword') ?? '');
    const confirmPassword = String(formData.get('confirmPassword') ?? '');

    if (!targetUserId) {
      setNotice(t('notices.passwordTargetRequired'), 'error');
      return;
    }

    if (newPassword !== confirmPassword) {
      setNotice(t('notices.passwordMismatch'), 'error');
      return;
    }

    setLoading(true);
    try {
      await fetchJson(`/users/${targetUserId}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ newPassword }),
      });

      const targetUser = users.find((user) => user.id === targetUserId);
      if (targetUserId === auth.user.id) {
        forceLogoutWithNotice(t('notices.passwordUpdatedSelfSignedOut'));
        return;
      }

      setNotice(
        t('notices.passwordUpdated', { displayName: targetUser?.displayName ?? targetUserId }),
        'success',
      );
      formElement.reset();
      setPasswordResetTargetUserId('');
    } catch (error) {
      setNotice(getDisplayError(error, t('notices.passwordUpdateFailed')), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCalendarWindowSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth || auth.user.role !== 'ADMIN') {
      return;
    }

    const slotMinTime = toCalendarTimePayloadValue(calendarWindowForm.slotMinTime);
    const slotMaxTime = toCalendarTimePayloadValue(calendarWindowForm.slotMaxTime);

    setLoading(true);
    try {
      const data = await fetchJson('/system-settings/calendar-window', {
        method: 'PATCH',
        body: JSON.stringify({ slotMinTime, slotMaxTime }),
      });
      const normalized = normalizeCalendarWindowSettings(data);
      setCalendarWindow(normalized);
      setCalendarWindowForm({
        slotMinTime: toCalendarTimeInputValue(normalized.slotMinTime),
        slotMaxTime: toCalendarTimeInputValue(normalized.slotMaxTime),
      });
      setNotice(t('notices.windowSaved'), 'success');
    } catch (error) {
      setNotice(getDisplayError(error, t('notices.windowSaveFailed')), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleUserStatus = async (userId: string, nextStatus: UserStatusValue) => {
    if (!auth || auth.user.role !== 'ADMIN') {
      return;
    }
    setLoading(true);
    try {
      await fetchJson(`/users/${userId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setNotice(nextStatus === 'ACTIVE' ? t('notices.userEnabled') : t('notices.userDisabled'), 'success');
      await loadUsers();
    } catch (error) {
      setNotice(getDisplayError(error, t('notices.statusUpdateFailed')), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveUser = async (user: UserRecord) => {
    if (!auth || auth.user.role !== 'ADMIN') {
      return;
    }
    const confirmed = window.confirm(t('confirm.removeUser', { displayName: user.displayName }));
    if (!confirmed) {
      setNotice(t('notices.actionCancelled'), 'info');
      return;
    }

    setLoading(true);
    try {
      await fetchJson(`/users/${user.id}`, {
        method: 'DELETE',
      });
      setNotice(t('notices.userRemoved'), 'success');
      await loadUsers();
    } catch (error) {
      setNotice(getDisplayError(error, t('notices.userRemovalFailed')), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCalendarDrop = async (info: any) => {
    if (!auth) {
      return;
    }
    try {
      const appointmentId = info.event.extendedProps?.appointmentId ?? info.event.id;
      await fetchJson(`/appointments/${appointmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          startAt: info.event.start?.toISOString(),
          endAt: info.event.end?.toISOString(),
          updatedById: auth.user.id,
        }),
      });
      await loadAppointments();
    } catch (error) {
      setNotice(getDisplayError(error, t('notices.moveFailed')), 'error');
      await loadAppointments();
    }
  };

  const handleCalendarResize = async (info: any) => {
    if (!auth) {
      return;
    }
    try {
      const appointmentId = info.event.extendedProps?.appointmentId ?? info.event.id;
      await fetchJson(`/appointments/${appointmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          startAt: info.event.start?.toISOString(),
          endAt: info.event.end?.toISOString(),
          updatedById: auth.user.id,
        }),
      });
      await loadAppointments();
    } catch (error) {
      setNotice(getDisplayError(error, t('notices.resizeFailed')), 'error');
      await loadAppointments();
    }
  };

  const handleDateClick = (info: DateClickArg) => {
    setSelectedDate(info.date);
    setEditingId(null);
    setNotice(t('notices.newDraft'), 'info');
    setForm((current) => applySlotClickToForm(current, info.date));
  };

  const applyStartDateShortcut = useCallback((shortcut: 'minus1' | 'today' | 'plus1' | 'plus3' | 'plus7') => {
    setForm((current) => {
      if (shortcut === 'today') {
        return { ...current, startDate: formatRelativeToToday(0) };
      }

      const incrementDays = shortcut === 'minus1'
        ? -1
        : shortcut === 'plus7'
          ? 7
          : shortcut === 'plus3'
            ? 3
            : 1;
      return { ...current, startDate: incrementUsDateInputByDays(current.startDate, incrementDays) };
    });
  }, []);

  const applyDurationShortcut = useCallback((minutes: number) => {
    setForm((current) => ({
      ...current,
      durationMinutes: String(minutes),
    }));
  }, []);

  const startDateWeekdayLabel = useMemo(() => {
    const weekdayShort = formatWeekdayFromUsDateInput(form.startDate, 'short', locale);
    const weekdayLong = formatWeekdayFromUsDateInput(form.startDate, 'long', locale);

    if (!weekdayShort || !weekdayLong) {
      return null;
    }

    return `${weekdayShort} (${weekdayLong})`;
  }, [form.startDate, locale]);

  const durationPreview = useMemo(() => {
    const durationMinutes = parseDurationMinutes(form.durationMinutes);
    const startAt = buildLocalDateTime(form.startDate, form.startTime, parseStartTimeInput);

    if (!startAt || durationMinutes === null) {
      return { text: t('editor.previewPlaceholder'), crossesDay: false };
    }

    const endAt = computeEndFromDuration(startAt, durationMinutes);
    const crossesDay = crossesIntoNextDay(startAt, endAt);

    return {
      text: t('editor.previewDerived', { value: formatDateTimeForPreview(endAt, locale) }),
      crossesDay,
    };
  }, [form.durationMinutes, form.startDate, form.startTime, locale, parseStartTimeInput, t]);

  const canApplyMinusOneStartDate = useMemo(() => {
    const startDate = parseUsDateInput(form.startDate);
    if (!startDate) {
      return false;
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return startDate.getTime() > today.getTime();
  }, [form.startDate]);

  const appointmentByIdMap = useMemo(() => {
    const idMap = new Map<string, AppointmentRecord>();

    for (const appointment of appointments) {
      idMap.set(appointment.id, appointment);
    }

    return idMap;
  }, [appointments]);

  const selectedAppointmentContext = useMemo(() => {
    if (!editingId) {
      return null;
    }

    return appointmentByIdMap.get(editingId) ?? null;
  }, [appointmentByIdMap, editingId]);

  useEffect(() => {
    if (!editingId) {
      return;
    }

    const stillExists = appointments.some((appointment) => appointment.id === editingId);
    if (!stillExists) {
      setEditingId(null);
      setForm(createInitialForm());
      setNotice(t('notices.selectedRemoved'), 'info');
    }
  }, [appointments, editingId, t]);

  const displayPhoneValue = useMemo(() => formatPhoneForDisplay(form.phone), [form.phone]);

  const handlePhoneInputChange = useCallback((value: string) => {
    setForm((current) => ({
      ...current,
      phone: normalizePhoneInput(value),
    }));
  }, []);

  const todaySummary = useMemo(() => {
    const now = new Date();
    const todayAppointments = appointments.filter((appointment) => {
      const startAt = new Date(appointment.startAt);
      return startAt.getFullYear() === now.getFullYear()
        && startAt.getMonth() === now.getMonth()
        && startAt.getDate() === now.getDate();
    });
    const sortedAppointments = [...todayAppointments].sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());
    const nextAppointment = sortedAppointments[0] ?? null;
    const revenue = todayAppointments.reduce((sum, appointment) => sum + Number(appointment.price), 0);

    return {
      label: formatDateOnlyForDisplay(now, locale),
      count: todayAppointments.length,
      revenue,
      nextAppointment,
    };
  }, [appointments, locale]);

  const selectedDateLabel = useMemo(() => {
    return formatDateOnlyForDisplay(selectedDate, locale);
  }, [selectedDate, locale]);

  const todayAgendaLabel = useMemo(() => {
    return formatDateOnlyForDisplay(new Date(), locale);
  }, [locale]);

  const manageableUsers = useMemo(() => {
    if (!auth) {
      return users.filter((user) => user.username !== PENDING_EMPLOYEE_USERNAME);
    }

    return users.filter((user) => user.id !== auth.user.id && user.username !== PENDING_EMPLOYEE_USERNAME);
  }, [users, auth]);

  const passwordResetUsers = useMemo(
    () => users.filter((user) => user.username !== PENDING_EMPLOYEE_USERNAME),
    [users],
  );

  const formatAuditPayloadPreview = useCallback((payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return '-';
    }

    const data = payload as Record<string, unknown>;
    const fields = ['status', 'employeeId', 'startAt', 'endAt', 'displayName', 'role', 'phone', 'price'] as const;
    const summary = fields
      .filter((field) => data[field] !== undefined && data[field] !== null)
      .map((field) => `${field}: ${String(data[field])}`)
      .slice(0, 4);

    if (summary.length === 0) {
      return '-';
    }

    return summary.join(' | ');
  }, []);

  const handleRefreshLogs = useCallback(async () => {
    if (!auth || auth.user.role !== 'ADMIN') {
      return;
    }

    setLogsLoading(true);
    try {
      await loadAuditLogs();
      setNotice(t('notices.logsRefreshed'), 'success');
    } catch (error) {
      setNotice(getDisplayError(error, t('notices.refreshLogsFailed')), 'error');
    } finally {
      setLogsLoading(false);
    }
  }, [auth, loadAuditLogs, t]);

  const filteredAppointments = useMemo(() => {
    if (employeeFilter === 'all') {
      return appointments;
    }

    return appointments.filter((appointment) => appointment.employeeId === employeeFilter);
  }, [appointments, employeeFilter]);

  const todayAgendaAppointments = useMemo(() => {
    const now = new Date();

    return filteredAppointments
      .filter((appointment) => isSameLocalDate(new Date(appointment.startAt), now))
      .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());
  }, [filteredAppointments]);

  const todayAgendaByEmployee = useMemo(() => {
    const grouped = new Map<string, AppointmentRecord[]>();

    for (const appointment of todayAgendaAppointments) {
      const entries = grouped.get(appointment.employeeId);
      if (entries) {
        entries.push(appointment);
      } else {
        grouped.set(appointment.employeeId, [appointment]);
      }
    }

    return Array.from(grouped.entries())
      .map(([employeeId, groupedAppointments]) => ({
        employeeId,
        employeeName: getEmployeeName(employeeId),
        appointments: [...groupedAppointments].sort(
          (left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime(),
        ),
      }))
      .sort((left, right) => left.employeeName.localeCompare(right.employeeName));
  }, [todayAgendaAppointments, employeeOptions]);

  const handleCalendarDatesSet = useCallback((info: DatesSetArg) => {
    const anchorDate = calendarRef.current?.getApi().getDate();
    setSelectedDate(anchorDate ? new Date(anchorDate) : new Date(info.start));
  }, []);

  const handleMobileCalendarNavigate = useCallback((action: 'prev' | 'next' | 'today') => {
    const api = calendarRef.current?.getApi();
    if (!api) {
      return;
    }

    if (action === 'prev') {
      api.prev();
    } else if (action === 'next') {
      api.next();
    } else {
      const today = new Date();
      api.gotoDate(today);
      setSelectedDate(today);
      return;
    }

    setSelectedDate(api.getDate());
  }, []);

  const renderCalendarEventContent = useCallback((eventContent: EventContentArg) => {
    const note = resolveCalendarEventNote(eventContent.event);

    return (
      <div className="calendar-event-content">
        <div className="calendar-event-time">{eventContent.timeText}</div>
        <div className="calendar-event-title">{eventContent.event.title}</div>
        {note ? <div className="calendar-event-note">{note}</div> : null}
      </div>
    );
  }, []);

  const handleCalendarEventDidMount = useCallback((mountInfo: EventMountArg) => {
    const noteElement = mountInfo.el.querySelector('.calendar-event-note');
    if (!(noteElement instanceof HTMLElement)) {
      return;
    }

    const noteText = noteElement.textContent?.trim();
    if (!noteText) {
      noteElement.removeAttribute('title');
      return;
    }

    const cleanup = bindCalendarEventNoteTooltip(noteElement, noteText);
    calendarEventTooltipCleanupRef.current.set(mountInfo.el, cleanup);
  }, []);

  const handleCalendarEventWillUnmount = useCallback((mountInfo: EventMountArg) => {
    const cleanup = calendarEventTooltipCleanupRef.current.get(mountInfo.el);
    if (!cleanup) {
      return;
    }

    cleanup();
    calendarEventTooltipCleanupRef.current.delete(mountInfo.el);
  }, []);

  const calendarEvents = useMemo<EventInput[]>(() => {
    return filteredAppointments
      .map((appointment) => {
        const employeeColor = getEmployeeColor(appointment.employeeId);
        const isPendingAssignment = pendingEmployee?.id === appointment.employeeId;
        const normalizedNote = appointment.note?.trim();
        const titleParts = [getEmployeeName(appointment.employeeId), appointment.customerName ?? ''];
        const backgroundColor = isPendingAssignment
          ? `color-mix(in srgb, ${CALENDAR_EVENT_BACKGROUND_DARK} ${100 - CALENDAR_PENDING_EVENT_TINT}%, ${PENDING_EMPLOYEE_COLOR} ${CALENDAR_PENDING_EVENT_TINT}%)`
          : `color-mix(in srgb, ${CALENDAR_EVENT_BACKGROUND_DARK} ${100 - CALENDAR_EVENT_EMPLOYEE_TINT}%, ${employeeColor} ${CALENDAR_EVENT_EMPLOYEE_TINT}%)`;
        return {
          id: appointment.id,
          title: titleParts.filter(Boolean).join(' • '),
          start: appointment.startAt,
          end: appointment.endAt,
          backgroundColor,
          borderColor: employeeColor,
          textColor: CALENDAR_EVENT_TEXT_LIGHT,
          borderWidth: '1px',
          display: 'block',
          classNames: [isPendingAssignment ? 'calendar-event-pending-assignment' : 'calendar-event-assigned'],
          extendedProps: {
            appointmentId: appointment.id,
            employeeId: appointment.employeeId,
            employeeName: getEmployeeName(appointment.employeeId),
            note: normalizedNote,
            remark: normalizedNote,
            description: normalizedNote,
            memo: normalizedNote,
            comment: normalizedNote,
          },
        };
      });
  }, [filteredAppointments, getEmployeeColor, getEmployeeName, pendingEmployee]);

  const primaryCalendarControl = getPrimaryCalendarControl(isMobileCalendarLayout);
  const primaryCalendarControlLabel = primaryCalendarControl.view === 'timeGridThreeDay'
    ? t('calendar.viewThreeDay')
    : t('calendar.viewWeek');

  if (isAuthBootstrapping) {
    return (
      <div className="app-shell">
        <div className="card">
          <h1>{t('app.title')}</h1>
          <p>{t('login.signingIn')}</p>
        </div>
      </div>
    );
  }

  if (!auth) {
    return (
      <div className="app-shell">
        <div className="card">
          <h1>{t('app.title')}</h1>
          <p>{t('login.subtitle')}</p>
          <form onSubmit={handleLogin} className="stack">
            <label>
              {t('login.username')}
              <input value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} />
            </label>
            <label>
              {t('login.password')}
              <input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
            </label>
            <button type="submit" disabled={loading}>{loading ? t('login.signingIn') : t('login.signIn')}</button>
          </form>
          {message ? <p className={`message ${messageTone}`}>{message}</p> : null}
        </div>
      </div>
    );
  }

  const isAdmin = auth.user.role === 'ADMIN';
  const showCalendarPanel = !isAdmin || adminPanel === 'calendar';
  const showOverviewPanel = isAdmin && adminPanel === 'overview';
  const showAdminPanel = isAdmin && adminPanel === 'admin';
  const showLogsPanel = isAdmin && adminPanel === 'logs';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>{t('app.title')}</h1>
          <p>{t('topbar.signedInAs', { displayName: auth.user.displayName, role: auth.user.role })}</p>
        </div>
        <div className="topbar-actions">
          <div className="locale-toggle" role="group" aria-label={t('topbar.localeSwitch')}>
            <button
              type="button"
              className={locale === 'en' ? 'active' : ''}
              onClick={() => setLocale('en')}
            >
              {t('locale.en')}
            </button>
            <span className="locale-separator">|</span>
            <button
              type="button"
              className={locale === 'zh-CN' ? 'active' : ''}
              onClick={() => setLocale('zh-CN')}
            >
              {t('locale.zh-CN')}
            </button>
          </div>
          <button onClick={handleLogout}>{t('topbar.signOut')}</button>
        </div>
      </header>

      {message ? <p className={`message ${messageTone}`}>{message}</p> : null}

      {isAdmin ? (
        <div className="panel-tabs" role="tablist" aria-label="Dashboard sections">
          <button
            type="button"
            className={adminPanel === 'calendar' ? 'active' : ''}
            aria-selected={adminPanel === 'calendar'}
            onClick={() => setAdminPanel('calendar')}
          >
            {t('tabs.calendar')}
          </button>
          <button
            type="button"
            className={adminPanel === 'overview' ? 'active' : ''}
            aria-selected={adminPanel === 'overview'}
            onClick={() => setAdminPanel('overview')}
          >
            {t('tabs.overview')}
          </button>
          <button
            type="button"
            className={adminPanel === 'admin' ? 'active' : ''}
            aria-selected={adminPanel === 'admin'}
            onClick={() => setAdminPanel('admin')}
          >
            {t('tabs.admin')}
          </button>
          <button
            type="button"
            className={adminPanel === 'logs' ? 'active' : ''}
            aria-selected={adminPanel === 'logs'}
            onClick={() => setAdminPanel('logs')}
          >
            {t('tabs.logs')}
          </button>
        </div>
      ) : null}

      {showCalendarPanel ? (
        <>
          <div className="dashboard-grid">
            <section className="card dashboard-card calendar-card">
              <h2>{t('editor.title')}</h2>
              <p className="hint">{editingId ? t('editor.hintEditing') : t('editor.hintCreate')}</p>
              {selectedAppointmentContext ? (
                <div className="context-card">
                  <div className="context-title">{t('editor.selectedAppointment')}</div>
                  <div className="context-meta">
                    <span><strong>{getEmployeeName(selectedAppointmentContext.employeeId)}</strong></span>
                    <span>{t('overview.badgePhone', { value: selectedAppointmentContext.phone })}</span>
                    <span>{formatAppointmentWindow(selectedAppointmentContext.startAt, selectedAppointmentContext.endAt, locale)}</span>
                  </div>
                </div>
              ) : null}
              <form onSubmit={handleCreateOrUpdate} className="stack">
                <label>
                  <span className="field-label">{t('editor.employee')}</span>
                  <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                    <option value="">{t('editor.pendingAssignment')}</option>
                    {assignableEmployeeOptions.map((user) => (
                      <option key={user.id} value={user.id}>{user.displayName}</option>
                    ))}
                  </select>
                </label>
                <div className="row">
                  <label>
                    <span className="field-label">
                      {t('editor.startDate')} <span className="required-indicator" aria-hidden="true">*</span>
                      <span className="field-label-note" aria-live="polite">
                        {startDateWeekdayLabel ? startDateWeekdayLabel : t('editor.invalidDate')}
                      </span>
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder={t('editor.startDatePlaceholder')}
                      aria-label={t('editor.startDateAria')}
                      pattern="\d{2}/\d{2}/\d{4}"
                      title={t('editor.startDateTitle')}
                      value={form.startDate}
                      onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    />
                    <div className="quick-date-shortcuts" role="group" aria-label={t('editor.quickDateAria')}>
                      <button
                        type="button"
                        onClick={() => applyStartDateShortcut('minus1')}
                        disabled={!canApplyMinusOneStartDate}
                      >
                        {t('shortcut.prevDay')}
                      </button>
                      <button type="button" onClick={() => applyStartDateShortcut('today')}>{t('shortcut.today')}</button>
                      <button type="button" onClick={() => applyStartDateShortcut('plus1')}>{t('shortcut.plus1')}</button>
                      <button type="button" onClick={() => applyStartDateShortcut('plus3')}>{t('shortcut.plus3')}</button>
                      <button type="button" onClick={() => applyStartDateShortcut('plus7')}>{t('shortcut.plus7')}</button>
                    </div>
                    <span className="hint">{t('editor.dateHint')}</span>
                  </label>
                  <label>
                    <span className="field-label">
                      {t('editor.startTime')} <span className="required-indicator" aria-hidden="true">*</span>
                    </span>
                    <input
                      type="text"
                      inputMode="text"
                      autoCapitalize="off"
                      autoCorrect="off"
                      aria-label={t('editor.startTime')}
                      placeholder="14:30 / 2:30 / 2"
                      value={form.startTime}
                      onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                      onBlur={() => {
                        const parsed = parseStartTimeInput(form.startTime);
                        if (parsed) {
                          setForm((current) => ({ ...current, startTime: parsed.normalized }));
                        }
                      }}
                    />
                  </label>
                </div>
                <div className="row">
                  <label>
                    <span className="field-label">
                      {t('editor.duration')} <span className="required-indicator" aria-hidden="true">*</span>
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={5}
                      value={form.durationMinutes}
                      onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                    />
                    <div className="quick-duration-shortcuts" role="group" aria-label={t('editor.quickDurationAria')}>
                      {DURATION_QUICK_SELECT_MINUTES.map((minutes) => (
                        <button
                          key={minutes}
                          type="button"
                          className={form.durationMinutes.trim() === String(minutes) ? 'active' : ''}
                          onClick={() => applyDurationShortcut(minutes)}
                        >
                          {minutes}
                        </button>
                      ))}
                    </div>
                    <span className={`hint ${durationPreview.crossesDay ? 'duration-preview-error' : ''}`}>
                      {durationPreview.text}
                    </span>
                  </label>
                </div>
                <div className="row">
                  <label>
                    <span className="field-label">
                      {t('editor.phone')} <span className="required-indicator" aria-hidden="true">*</span>
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="(___)___-____"
                      value={displayPhoneValue}
                      onChange={(e) => handlePhoneInputChange(e.target.value)}
                    />
                  </label>
                  <label>
                    <span className="field-label">
                      {t('editor.price')}
                    </span>
                    <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
                  </label>
                </div>
                <label>
                  {t('editor.customerName')}
                  <input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
                </label>
                <label>
                  {t('editor.note')}
                  <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </label>
                <div className="row">
                  <button type="submit" disabled={loading}>{editingId ? t('actions.updateAppointment') : t('actions.createAppointment')}</button>
                  {editingId ? <button type="button" onClick={() => { setEditingId(null); setForm(createInitialForm()); }}>{t('actions.cancel')}</button> : null}
                  {editingId ? <button type="button" className={isAdmin ? 'danger-action' : ''} disabled={loading} onClick={() => void handleDelete(editingId)}>{isAdmin ? t('actions.deleteAppointment') : t('actions.cancelAppointment')}</button> : null}
                </div>
              </form>
            </section>

            <section className="card dashboard-card">
              <h2>{t('calendar.title')}</h2>
              <div className="calendar-controls">
                <div className="calendar-title-row">
                  <div>
                    <strong>{t('calendar.scheduleView')}</strong>
                    <div className="hint">{t('calendar.scheduleHint')}</div>
                    <div className="hint">{t('calendar.windowLabel', { start: calendarWindow.slotMinTime, end: calendarWindow.slotMaxTime })}</div>
                  </div>
                </div>
                <div className="toolbar">
                  <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
                    <option value="all">{t('calendar.allEmployees')}</option>
                    {employeeOptions.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.username === PENDING_EMPLOYEE_USERNAME ? t('editor.pendingAssignment') : user.displayName}
                      </option>
                    ))}
                  </select>
                  <div className="toggle-row">
                    <button
                      type="button"
                      className={calendarView === primaryCalendarControl.view ? 'active' : ''}
                      onClick={() => setCalendarView(primaryCalendarControl.view)}
                    >
                      {primaryCalendarControlLabel}
                    </button>
                    <button type="button" className={calendarView === 'timeGridDay' ? 'active' : ''} onClick={() => setCalendarView('timeGridDay')}>{t('calendar.viewDay')}</button>
                  </div>
                </div>
                <div className="legend">
                  {employeeOptions.map((user) => (
                    <div key={user.id} className="legend-item">
                      <span className="legend-swatch" style={{ backgroundColor: getEmployeeColor(user.id) }} />
                      <span>{user.username === PENDING_EMPLOYEE_USERNAME ? t('editor.pendingAssignment') : user.displayName}</span>
                    </div>
                  ))}
                </div>
                <div className="date-strip" aria-label={t('calendar.dateNavAria')}>
                  <div className="date-strip-actions">
                    <button type="button" onClick={() => handleMobileCalendarNavigate('prev')}>{t('calendar.prev')}</button>
                    <button type="button" onClick={() => handleMobileCalendarNavigate('today')}>{t('shortcut.today')}</button>
                    <button type="button" onClick={() => handleMobileCalendarNavigate('next')}>{t('calendar.next')}</button>
                  </div>
                  <div className="date-strip-label">{selectedDateLabel}</div>
                </div>
              </div>
              <div className="calendar-frame">
                <FullCalendar
                  ref={calendarRef}
                  key={calendarView}
                  plugins={[timeGridPlugin, interactionPlugin]}
                  initialView={calendarView}
                  initialDate={selectedDate}
                  headerToolbar={false}
                  views={{
                    timeGridWeek: {
                      slotEventOverlap: false,
                      eventMinHeight: 22,
                    },
                    timeGridThreeDay: {
                      type: 'timeGrid',
                      duration: { days: 3 },
                    },
                  }}
                  dayHeaderContent={(arg) => (
                    <div className="calendar-day-header" aria-label={arg.text}>
                      <span className="calendar-day-header-weekday">{calendarDayHeaderWeekdayFormatter.format(arg.date)}</span>
                      <span className="calendar-day-header-date">{calendarDayHeaderDateFormatter.format(arg.date)}</span>
                    </div>
                  )}
                  allDaySlot={false}
                  slotMinTime={calendarWindow.slotMinTime}
                  slotMaxTime={calendarWindow.slotMaxTime}
                  slotDuration="00:30:00"
                  snapDuration="00:30:00"
                  slotLabelInterval="01:00:00"
                  slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
                  eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
                  editable={true}
                  selectable={true}
                  selectMirror={true}
                  progressiveEventRendering={true}
                  rerenderDelay={40}
                  events={calendarEvents}
                  eventContent={renderCalendarEventContent}
                  eventDidMount={handleCalendarEventDidMount}
                  eventWillUnmount={handleCalendarEventWillUnmount}
                  eventDrop={handleCalendarDrop}
                  eventResize={handleCalendarResize}
                  dateClick={handleDateClick}
                  datesSet={handleCalendarDatesSet}
                  eventClick={(info) => {
                    const clicked = appointmentByIdMap.get(info.event.id);
                    if (clicked) {
                      handleEdit(clicked);
                    }
                  }}
                />
              </div>
              <div className="day-agenda" aria-live="polite">
                <div className="agenda-header">
                  <h3>{t('agenda.title')}</h3>
                  <div className="toggle-row agenda-mode-toggle" role="group" aria-label={t('agenda.modeAria')}>
                    <button
                      type="button"
                      className={todayAgendaMode === 'time' ? 'active' : ''}
                      onClick={() => setTodayAgendaMode('time')}
                    >
                      {t('agenda.modeTime')}
                    </button>
                    <button
                      type="button"
                      className={todayAgendaMode === 'employee' ? 'active' : ''}
                      onClick={() => setTodayAgendaMode('employee')}
                    >
                      {t('agenda.modeEmployee')}
                    </button>
                  </div>
                </div>
                <p className="hint">{todayAgendaLabel}</p>
                {todayAgendaAppointments.length === 0 ? (
                  <div className="agenda-empty">{t('agenda.noneToday')}</div>
                ) : todayAgendaMode === 'time' ? (
                  <div className="agenda-list">
                    {todayAgendaAppointments.map((appointment) => (
                      <button
                        key={appointment.id}
                        type="button"
                        className="agenda-item"
                        style={{ '--agenda-accent': getEmployeeColor(appointment.employeeId) } as CSSProperties}
                        onClick={() => handleEdit(appointment)}
                      >
                        <div className="agenda-time">{formatAgendaTimeRange(appointment.startAt, appointment.endAt, locale)}</div>
                        <div className="agenda-meta">
                          <span>{getEmployeeName(appointment.employeeId)}</span>
                          <span>{t('agenda.phone', { value: appointment.phone })}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="agenda-groups">
                    {todayAgendaByEmployee.map((group) => (
                      <section key={group.employeeId} className="agenda-group">
                        <div className="agenda-group-title">
                          <span className="legend-swatch" style={{ backgroundColor: getEmployeeColor(group.employeeId) }} />
                          <strong>{group.employeeName}</strong>
                        </div>
                        <div className="agenda-list">
                          {group.appointments.map((appointment) => (
                            <button
                              key={appointment.id}
                              type="button"
                              className="agenda-item"
                              style={{ '--agenda-accent': getEmployeeColor(appointment.employeeId) } as CSSProperties}
                              onClick={() => handleEdit(appointment)}
                            >
                              <div className="agenda-time">{formatAgendaTimeRange(appointment.startAt, appointment.endAt, locale)}</div>
                              <div className="agenda-meta">
                                <span>{t('agenda.phone', { value: appointment.phone })}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </>
      ) : null}

      {showOverviewPanel ? (
        <section className="card desktop-day-overview">
          <div className="day-summary">
            <div>
              <h2>{t('overview.title')}</h2>
              <p className="hint">{todaySummary.label}</p>
            </div>
            <div className="day-summary-grid">
              <div className="summary-pill">
                <span className="summary-label">{t('overview.appointments')}</span>
                <strong>{todaySummary.count}</strong>
              </div>
              <div className="summary-pill">
                <span className="summary-label">{t('overview.revenue')}</span>
                <strong>${todaySummary.revenue.toFixed(2)}</strong>
              </div>
              <div className="summary-pill">
                <span className="summary-label">{t('overview.next')}</span>
                <strong>{todaySummary.nextAppointment ? `${formatTimeOnly(todaySummary.nextAppointment.startAt, locale)} • ${getEmployeeName(todaySummary.nextAppointment.employeeId)}` : t('overview.none')}</strong>
              </div>
            </div>
          </div>
          <h3 className="section-title">{t('overview.todayAppointments')}</h3>
          <div className="appointment-list">
            {appointments.map((appointment) => {
              const employee = users.find((user) => user.id === appointment.employeeId);
              return (
                <div key={appointment.id} className="appointment-item" style={{ borderLeftColor: getEmployeeColor(appointment.employeeId) }}>
                  <div className="appointment-main">
                    <div className="appointment-heading">
                      <span className="employee-marker" style={{ backgroundColor: getEmployeeColor(appointment.employeeId) }} />
                      <div>
                        <strong>
                          {employee
                            ? (employee.username === PENDING_EMPLOYEE_USERNAME ? t('editor.pendingAssignment') : employee.displayName)
                            : t('overview.employeeFallback')}
                        </strong>
                        <div className="appointment-time">{formatAppointmentWindow(appointment.startAt, appointment.endAt, locale)}</div>
                      </div>
                    </div>
                    <div className="appointment-details">
                      <span className="appointment-badge">{t('overview.badgePhone', { value: appointment.phone })}</span>
                      <span className="appointment-badge appointment-price">{t('overview.badgePrice', { value: appointment.price })}</span>
                    </div>
                  </div>
                  <div className="appointment-actions">
                    <button type="button" onClick={() => handleEdit(appointment)}>{t('actions.edit')}</button>
                    <button type="button" onClick={() => void handleDelete(appointment.id)}>{auth.user.role === 'ADMIN' ? t('actions.delete') : t('actions.cancelShort')}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {showAdminPanel ? (
        <section className="card">
          <h2>{t('admin.title')}</h2>
          <div className="admin-block">
            <h3>{t('admin.calendarWindow')}</h3>
            <p className="hint">{t('admin.calendarWindowHint')}</p>
            <form onSubmit={handleCalendarWindowSave} className="stack">
              <div className="row">
                <label>
                  {t('admin.startTime')}
                  <input
                    type="time"
                    step={1800}
                    value={calendarWindowForm.slotMinTime}
                    onChange={(e) => setCalendarWindowForm((current) => ({ ...current, slotMinTime: e.target.value }))}
                    required
                  />
                </label>
                <label>
                  {t('admin.endTime')}
                  <input
                    type="time"
                    step={1800}
                    value={calendarWindowForm.slotMaxTime}
                    onChange={(e) => setCalendarWindowForm((current) => ({ ...current, slotMaxTime: e.target.value }))}
                    required
                  />
                </label>
              </div>
              <div className="row">
                <button type="submit" disabled={loading}>{t('admin.saveCalendarWindow')}</button>
              </div>
            </form>
          </div>

          <form onSubmit={handleAdminCreateUser} className="stack">
            <label>
              {t('login.username')}
              <input
                name="username"
                value={adminCreateUserForm.username}
                onChange={(event) => {
                  const nextUsername = event.target.value;
                  setAdminCreateUserForm((current) => ({
                    ...current,
                    username: nextUsername,
                    displayName: nextUsername,
                  }));
                }}
              />
            </label>
            <label>
              {t('login.password')}
              <input
                name="password"
                type="password"
                minLength={6}
                value={adminCreateUserForm.password}
                onChange={(event) => setAdminCreateUserForm((current) => ({ ...current, password: event.target.value }))}
              />
            </label>
            <label>
              {t('admin.confirmPassword')}
              <input
                name="confirmPassword"
                type="password"
                minLength={6}
                value={adminCreateUserForm.confirmPassword}
                onChange={(event) => setAdminCreateUserForm((current) => ({ ...current, confirmPassword: event.target.value }))}
              />
            </label>
            <label>
              {t('admin.displayName')}
              <input
                name="displayName"
                value={adminCreateUserForm.displayName}
                readOnly
                aria-readonly="true"
                className="read-only-field"
              />
            </label>
            <button type="submit">{t('admin.createUser')}</button>
          </form>

          <div className="admin-block">
            <h3>{t('admin.passwordResetTitle')}</h3>
            <p className="hint">{t('admin.passwordResetHint')}</p>
            <form onSubmit={handleAdminResetPassword} className="stack">
              <label>
                {t('admin.passwordTargetUser')}
                <select
                  name="targetUserId"
                  value={passwordResetTargetUserId}
                  onChange={(e) => setPasswordResetTargetUserId(e.target.value)}
                  required
                >
                  <option value="">{t('admin.selectUser')}</option>
                  {passwordResetUsers.map((user) => (
                    <option key={user.id} value={user.id}>{user.displayName} ({user.username})</option>
                  ))}
                </select>
              </label>
              <label>
                {t('admin.newPassword')}
                <input name="newPassword" type="password" minLength={6} required />
              </label>
              <label>
                {t('admin.confirmPassword')}
                <input name="confirmPassword" type="password" minLength={6} required />
              </label>
              <div className="row">
                <button type="submit" disabled={loading}>{t('admin.resetPassword')}</button>
              </div>
            </form>
          </div>

          <div className="user-list">
            {manageableUsers.map((user) => (
              <div key={user.id} className="user-item">
                <div>
                  <strong>{user.displayName}</strong>
                  <div>{user.username} • {user.role}</div>
                </div>
                <div className="user-actions">
                  <button
                    type="button"
                    onClick={() => handleToggleUserStatus(user.id, isActiveStatus(user.status) ? 'INACTIVE' : 'ACTIVE')}
                  >
                    {isActiveStatus(user.status) ? t('admin.disable') : t('admin.enable')}
                  </button>
                  {user.role !== 'ADMIN' ? (
                    <button type="button" onClick={() => void handleRemoveUser(user)}>{t('admin.remove')}</button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {showLogsPanel ? (
        <section className="card">
          <div className="toolbar logs-toolbar">
            <div>
              <h2>{t('logs.title')}</h2>
              <p className="hint">{t('logs.hint')}</p>
            </div>
            <div className="toggle-row">
              <span className="hint">{t('logs.total', { value: auditLogsTotal })}</span>
              <button type="button" onClick={() => void handleRefreshLogs()} disabled={logsLoading}>
                {logsLoading ? t('logs.refreshing') : t('logs.refresh')}
              </button>
            </div>
          </div>

          {auditLogs.length === 0 ? (
            <div className="agenda-empty">{t('logs.none')}</div>
          ) : (
            <div className="logs-list" role="list">
              {auditLogs.map((log) => (
                <article key={log.id} className="logs-item" role="listitem">
                  <div className="logs-row">
                    <strong>{log.action}</strong>
                    <span className="appointment-badge">{log.entityType}</span>
                    <span className="hint">{new Date(log.createdAt).toLocaleString(locale)}</span>
                  </div>
                  <div className="logs-meta">
                    <span>{t('logs.actor', { displayName: log.actor.displayName, username: log.actor.username })}</span>
                    <span>{t('logs.role', { role: log.actor.role })}</span>
                    <span>{t('logs.target', { entityType: log.entityType, entityId: log.entityId })}</span>
                  </div>
                  <div className="logs-diff">
                    <div><span className="summary-label">{t('logs.before')}</span> {formatAuditPayloadPreview(log.beforePayload)}</div>
                    <div><span className="summary-label">{t('logs.after')}</span> {formatAuditPayloadPreview(log.afterPayload)}</div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

export default App;
