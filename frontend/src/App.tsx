import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { OperationErrorDialog } from './OperationErrorDialog';
import { NativeDateChooser } from './NativeDateChooser';
import { getAuditPresentation } from './audit-presentation';
import { assertPersistedStaffColors } from './staff-colors';
import { CalendarEventBox, CalendarFrame, formatTimeOnly } from './calendar-presentation';
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
  formatAppointmentTimeInput,
  formatDateForUsInput,
  formatWeekdayFromUsDateInput,
  isLocalDateTimeInPast,
  type AppointmentTimeResolution,
  type ParsedFlexibleTimeInput,
  parseDurationMinutes,
  parseUsDateInput,
  resolveAppointmentTimeInput,
} from './appointment-time';
import {
  CALENDAR_SLOT_MAX_TIME,
  CALENDAR_SLOT_MIN_TIME,
  deriveCalendarDisplayWindow,
  isCalendarStartWithinBusinessHours,
  isValidCalendarWindowRange,
  normalizeCalendarWindowSettings,
  toCalendarTimeInputValue,
  toCalendarTimePayloadValue,
} from './calendar-time-window';
import {
  applyPhoneInputEdit,
  formatPhoneForDisplay,
  normalizePhoneInput,
  reconcilePhoneInputValue,
} from './phone-format';
import {
  DEFAULT_PENDING_EMPLOYEE_COLOR,
  getPendingAssignmentRuntime,
  isPendingAssignmentEmployee,
} from './pending-assignment';
import {
  applySlotClickToForm,
  getInitialCalendarViewForWidth,
  getPrimaryCalendarControl,
  MOBILE_CALENDAR_BREAKPOINT_PX,
} from './calendar-ui-logic';
import { useI18n } from './i18n/i18n';
import type { MessageKey } from './i18n/messages';

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
  needsShopSelection?: boolean;
  activeShopId?: string | null;
}

interface ShopSummary {
  id: string;
  name: string;
}

interface AppointmentRecord {
  id: string;
  employeeId: string;
  groupId?: string | null;
  employeeDisplayName?: string | null;
  employeeColor?: string | null;
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
  employeeIds: string[];
  partySize: string;
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
  role: UserRoleValue;
}

interface AuditLogRecord {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  beforePayload: unknown;
  afterPayload: unknown;
  actorSnapshot?: unknown;
  shopSnapshot?: unknown;
  shop?: { id: string; name: string };
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
type ReadErrorKey = 'users' | 'appointments' | 'calendarWindow' | 'auditLogs' | 'shopNames';
type UserStatusValue = 'ACTIVE' | 'INACTIVE';
type AdminPanel = 'calendar' | 'overview' | 'admin' | 'logs';
type TodayAgendaMode = 'time' | 'employee';
type CalendarView = 'timeGridWeek' | 'timeGridThreeDay' | 'timeGridDay';
type UserRoleValue = 'ADMIN' | 'EMPLOYEE' | 'MANAGER' | 'SHOP_ACCOUNT';
type ManagedUserRoleValue = 'EMPLOYEE' | 'MANAGER' | 'SHOP_ACCOUNT';
const DURATION_QUICK_SELECT_MINUTES = [30, 45, 60, 75, 90, 120] as const;

const API_BASE_URL = resolveApiBaseUrl({
  envBaseUrl: import.meta.env.VITE_API_BASE_URL,
  hostname: typeof window !== 'undefined' ? window.location.hostname : undefined,
  protocol: typeof window !== 'undefined' ? window.location.protocol : undefined,
});
const AUTH_STORAGE_KEY = 'shop-calendar-auth';
const EMPLOYEE_MANAGED_ROLES: ManagedUserRoleValue[] = ['EMPLOYEE', 'MANAGER', 'SHOP_ACCOUNT'];
const AUDIT_ACTION_MESSAGES: Record<string, MessageKey> = {
  'appointment.create': 'logs.action.appointment.create',
  'appointment.update': 'logs.action.appointment.update',
  'appointment.move': 'logs.action.appointment.move',
  'appointment.cancel': 'logs.action.appointment.cancel',
  'appointment.delete': 'logs.action.appointment.delete',
  'user.create': 'logs.action.user.create',
  'user.status.update': 'logs.action.user.status.update',
  'user.password.update': 'logs.action.user.password.update',
  'user.remove': 'logs.action.user.remove',
  'settings.calendar-window.update': 'logs.action.settings.calendar-window.update',
};
const ROLE_MESSAGES: Record<string, MessageKey> = {
  ADMIN: 'role.ADMIN',
  MANAGER: 'role.MANAGER',
  EMPLOYEE: 'role.EMPLOYEE',
  SHOP_ACCOUNT: 'role.SHOP_ACCOUNT',
};

const isAdminRole = (role: string) => role === 'ADMIN';
const isManagerRole = (role: string) => role === 'MANAGER';
const canManageAppointmentsRole = (role: string) => isAdminRole(role) || isManagerRole(role);
const canSwitchShopRole = (role: string) => isAdminRole(role) || isManagerRole(role);
const isEmployeeLikeRole = (role: string) => role === 'EMPLOYEE' || isManagerRole(role);
const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

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
    employeeIds: [],
    partySize: '1',
    startDate: formatDateForUsInput(today),
    startTime: '',
    durationMinutes: String(DEFAULT_APPOINTMENT_DURATION_MINUTES),
    phone: '',
    price: '',
    customerName: '',
    note: '',
  };
};
const CALENDAR_EVENT_BACKGROUND_DARK = '#0f172a';
const CALENDAR_EVENT_TEXT_LIGHT = '#f8fafc';
const CALENDAR_EVENT_EMPLOYEE_TINT = 28;
const CALENDAR_PENDING_EVENT_TINT = 20;
const CANCELLED_APPOINTMENT_ACCENT = '#94a3b8';
const CANCELLED_APPOINTMENT_BACKGROUND = 'rgba(71, 85, 105, 0.78)';

const hashStringToHue = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash) % 360;
};

// Legacy orphaned appointment IDs only; current staff must have persisted API colors.
const colorFromStableIdentifier = (identifier: string) => {
  const hue = hashStringToHue(identifier);
  return `hsl(${hue} 70% 56%)`;
};

const isActiveStatus = (status: string) => status.trim().toUpperCase() === 'ACTIVE';

const isCancelledAppointment = (appointment: AppointmentRecord) => appointment.status?.trim().toUpperCase() === 'CANCELLED';

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
  parseTime: (value: string) => ParsedFlexibleTimeInput | null,
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

const preserveAppointmentTimeForDate = (dateValue: string, originalStartAt: Date) => {
  const parsedDate = parseUsDateInput(dateValue);
  if (!parsedDate) {
    return null;
  }

  if (
    parsedDate.getFullYear() === originalStartAt.getFullYear()
    && parsedDate.getMonth() === originalStartAt.getMonth()
    && parsedDate.getDate() === originalStartAt.getDate()
  ) {
    return new Date(originalStartAt);
  }

  return new Date(
    parsedDate.getFullYear(),
    parsedDate.getMonth(),
    parsedDate.getDate(),
    originalStartAt.getHours(),
    originalStartAt.getMinutes(),
    0,
    0,
  );
};

const formatAgendaTimeRange = (startAt: string, endAt: string, locale: string) => {
  return `${formatTimeOnly(startAt, locale)} - ${formatTimeOnly(endAt, locale)}`;
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

const EVENT_NOTE_KEYS = ['note', 'remark', 'description', 'memo', 'comment'] as const;

const createInitialAdminCreateUserForm = (): AdminCreateUserFormState => ({
  username: '',
  password: '',
  confirmPassword: '',
  displayName: '',
  role: 'EMPLOYEE',
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

interface CalendarNoteTooltipText {
  closeButtonLabel: string;
  closeBackdropAriaLabel: string;
}

const isCalendarNoteTruncated = (element: HTMLElement) => {
  const horizontalOverflow = element.scrollWidth - element.clientWidth > 1;
  const verticalOverflow = element.scrollHeight - element.clientHeight > 1;
  return horizontalOverflow || verticalOverflow;
};

const bindCalendarEventNoteTooltip = (
  noteElement: HTMLElement,
  noteText: string,
  tooltipText: CalendarNoteTooltipText,
): CalendarNoteTooltipCleanup => {
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
    backdrop.setAttribute('aria-label', tooltipText.closeBackdropAriaLabel);

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
    closeButton.textContent = tooltipText.closeButtonLabel;

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

function FieldHelp({ id, text, label }: { id: string; text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLSpanElement>(null);
  // Pointer focus must not open just before click toggles it closed.
  const pointerFocus = useRef(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <span className="start-time-help" ref={host}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') setOpen(true); }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse' && !host.current?.contains(document.activeElement)) setOpen(false);
      }}>
      <button type="button" className="start-time-help-button" aria-label={label}
        aria-expanded={open} aria-controls={id}
        aria-describedby={open ? id : undefined}
        onPointerDown={() => { pointerFocus.current = true; }}
        onMouseDown={(event) => event.preventDefault()}
        onFocus={() => { if (!pointerFocus.current) setOpen(true); }}
        onBlur={() => setOpen(false)}
        onClick={() => { pointerFocus.current = false; setOpen((value) => !value); }}>
        ⓘ
      </button>
      <span id={id} role="tooltip" className="start-time-help-content" hidden={!open}>{text}</span>
    </span>
  );
}

const startTimeErrorKey = (status: Exclude<AppointmentTimeResolution['status'], 'valid'>): MessageKey => (
  status === 'window-unavailable' ? 'notices.calendarWindowUnavailable'
    : status === 'ambiguous' ? 'notices.startTimeAmbiguous'
      : status === 'outside-window' ? 'notices.startTimeOutsideWindow'
        : 'notices.startTimeInvalid'
);

function App() {
  const { locale, setLocale, t } = useI18n();
  const initialStoredAuthRef = useRef<AuthResponse | null>(readStoredAuth());
  const [auth, setAuth] = useState<AuthResponse | null>(() => initialStoredAuthRef.current);
  const [isAuthBootstrapping, setIsAuthBootstrapping] = useState(() => initialStoredAuthRef.current !== null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [adminUsers, setAdminUsers] = useState<UserRecord[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [form, setForm] = useState<AppointmentFormState>(() => createInitialForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const originalEditingStartAtRef = useRef<Date | null>(null);
  const appointmentStartTimeEditedRef = useRef(false);
  const [startTimeError, setStartTimeError] = useState<MessageKey | null>(null);
  const rejectedStartTimeInputRef = useRef(false);
  const clearStartTimeError = useCallback(() => {
    rejectedStartTimeInputRef.current = false;
    setStartTimeError(null);
  }, []);
  const rejectStartTimeInput = () => {
    rejectedStartTimeInputRef.current = true;
    setStartTimeError('notices.startTimeInvalid');
  };
  const [originalEditingPrice, setOriginalEditingPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [operationErrors, setOperationErrors] = useState<string[]>([]);
  const operationErrorsRef = useRef<string[]>([]);
  const operationError = operationErrors[0] ?? '';
  const showOperationError = useCallback((text: string) => {
    if (sessionExpiredRef.current || text === t('notices.sessionExpired')) {
      return;
    }
    if (operationErrorsRef.current.includes(text)) {
      return;
    }
    const next = [...operationErrorsRef.current, text];
    operationErrorsRef.current = next;
    setOperationErrors(next);
  }, [t]);
  const closeOperationError = useCallback(() => {
    const next = operationErrorsRef.current.slice(1);
    operationErrorsRef.current = next;
    setOperationErrors(next);
  }, []);

  const [message, setMessage] = useState<string>('');
  const [messageTone, setMessageTone] = useState<MessageTone>('info');
  const [readErrors, setReadErrors] = useState<Record<string, string>>({});
  const [phoneLookupError, setPhoneLookupError] = useState<{ phone: string; shopId: string | null; message: string } | null>(null);
  const [phoneLookupRetry, setPhoneLookupRetry] = useState(0);
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
  const [calendarWindowReady, setCalendarWindowReady] = useState(false);
  const initialCalendarScrollConsumed = useRef(false);
  const displayCalendarWindow = deriveCalendarDisplayWindow(calendarWindow);
  const [calendarWindowForm, setCalendarWindowForm] = useState<CalendarWindowFormState>(() => ({
    slotMinTime: toCalendarTimeInputValue(CALENDAR_SLOT_MIN_TIME),
    slotMaxTime: toCalendarTimeInputValue(CALENDAR_SLOT_MAX_TIME),
  }));
  const calendarWindowFormRef = useRef(calendarWindowForm);
  calendarWindowFormRef.current = calendarWindowForm;
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [auditLogsTotal, setAuditLogsTotal] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);
  // Calendar browse anchor only; appointment slot clicks edit the draft, not this date.
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [todayAgendaMode, setTodayAgendaMode] = useState<TodayAgendaMode>('time');
  const [employeeDropdownOpen, setEmployeeDropdownOpen] = useState(false);
  const [shopSelection, setShopSelection] = useState<{
    authForRequest: AuthResponse;
    shops: ShopSummary[];
    loading: boolean;
    error: string;
  } | null>(null);
  const [selectedShopId, setSelectedShopId] = useState('');
  const [availableShops, setAvailableShops] = useState<ShopSummary[]>([]);
  const calendarRef = useRef<FullCalendar | null>(null);
  const calendarEventTooltipCleanupRef = useRef<Map<HTMLElement, CalendarNoteTooltipCleanup>>(new Map());
  const sseConnectionRef = useRef<EventSource | null>(null);
  const refreshDebounceRef = useRef<number | null>(null);
  const authRef = useRef<AuthResponse | null>(initialStoredAuthRef.current);
  const refreshInFlightRef = useRef<Promise<AuthResponse | null> | null>(null);
  const sessionExpiredRef = useRef(false);
  const shopContextVersionRef = useRef(0);
  const usersLoadedRef = useRef(false);
  const appointmentsLoadedRef = useRef(false);
  const calendarWindowLoadedRef = useRef(false);
  const auditLogsLoadedRef = useRef(false);
  const shopSelectionRequestIdRef = useRef(0);
  const shopNamesRequestIdRef = useRef(0);
  const phoneLookupRequestIdRef = useRef(0);
  const phoneInputRef = useRef<HTMLInputElement | null>(null);
  const phoneBeforeInputHandlerRef = useRef<((input: HTMLInputElement, event: InputEvent) => void) | null>(null);
  const phoneBeforeInputListenerRef = useRef<EventListener | null>(null);
  const phonePasteDataRef = useRef<string | null>(null);
  const phoneBeforeInputRef = useRef<{
    digits: string;
    selectionStart: number;
    selectionEnd: number;
    inputType: string;
    data: string | null;
  } | null>(null);
  const pendingPhoneSelectionRef = useRef<{
    digits: string;
    selectionStart: number;
    selectionEnd: number;
  } | null>(null);
  const availableShopsUserIdRef = useRef<string | null>(null);
  const phoneNameEditedRef = useRef(false);
  const phoneNoteEditedRef = useRef(false);
  const formRef = useRef(form);
  formRef.current = form;
  const authContextVersion = shopContextVersionRef.current;

  useLayoutEffect(() => {
    const pending = pendingPhoneSelectionRef.current;
    const input = phoneInputRef.current;
    if (!pending || !input || pending.digits !== form.phone) {
      return;
    }

    input.setSelectionRange(pending.selectionStart, pending.selectionEnd);
    pendingPhoneSelectionRef.current = null;
  }, [form.phone]);

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
    if (!auth || (!isAdminRole(auth.user.role) && !isManagerRole(auth.user.role))) {
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
    () => users.filter((user) => isActiveStatus(user.status) && isEmployeeLikeRole(user.role)),
    [users],
  );

  const pendingAssignmentRuntime = useMemo(() => getPendingAssignmentRuntime(), []);

  const pendingEmployee = useMemo(
    () => employeeOptions.find((user) => isPendingAssignmentEmployee(user, pendingAssignmentRuntime)) ?? null,
    [employeeOptions, pendingAssignmentRuntime],
  );

  const assignableEmployeeOptions = useMemo(
    () => employeeOptions.filter((user) => !isPendingAssignmentEmployee(user, pendingAssignmentRuntime)),
    [employeeOptions, pendingAssignmentRuntime],
  );

  const nameListSeparator = locale === 'zh-CN' ? '、' : ', ';

  const selectedEmployeeNamesLabel = useMemo(() => {
    const names = form.employeeIds
      .map((id) => assignableEmployeeOptions.find((user) => user.id === id)?.displayName)
      .filter((name): name is string => Boolean(name));
    return names.join(nameListSeparator);
  }, [form.employeeIds, assignableEmployeeOptions, nameListSeparator]);

  const partySizeValue = Math.max(1, parseInt(form.partySize, 10) || 1);

  const pendingAutoCount = Math.max(0, partySizeValue - form.employeeIds.length);

  const employeeColorMap = useMemo(() => {
    const colorMap = new Map<string, string>();

    for (const employee of employeeOptions) {
      if (isPendingAssignmentEmployee(employee, pendingAssignmentRuntime)) {
        colorMap.set(employee.id, DEFAULT_PENDING_EMPLOYEE_COLOR);
        continue;
      }

      const configuredColor = employee.color?.trim();
      if (configuredColor) colorMap.set(employee.id, configuredColor);
    }

    return colorMap;
  }, [employeeOptions, pendingAssignmentRuntime]);

  const employeeNameMap = useMemo(() => {
    const nameMap = new Map<string, string>();

    for (const user of users) {
      const normalizedDisplayName = isPendingAssignmentEmployee(user, pendingAssignmentRuntime)
        ? t('editor.pendingAssignment')
        : user.displayName;
      nameMap.set(user.id, normalizedDisplayName);
    }

    return nameMap;
  }, [users, t]);

  const getEmployeeColor = useCallback((employeeId: string) => {
    if (!employeeId.trim()) {
      return DEFAULT_PENDING_EMPLOYEE_COLOR;
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

  const isAppointmentTentative = useCallback((appointment: AppointmentRecord) => {
    if (!pendingEmployee) {
      return false;
    }

    return appointment.employeeId === pendingEmployee.id;
  }, [pendingEmployee]);

  const getAppointmentDisplayName = useCallback((appointment: AppointmentRecord) => {
    if (isAppointmentTentative(appointment)) {
      return t('editor.pendingAssignment');
    }

    const snapshotName = appointment.employeeDisplayName?.trim();
    if (snapshotName) {
      return snapshotName;
    }

    return getEmployeeName(appointment.employeeId);
  }, [getEmployeeName, isAppointmentTentative, t]);

  const getAppointmentColor = useCallback((appointment: AppointmentRecord) => {
    if (isAppointmentTentative(appointment)) {
      return DEFAULT_PENDING_EMPLOYEE_COLOR;
    }

    const snapshotColor = appointment.employeeColor?.trim();
    if (snapshotColor) {
      return snapshotColor;
    }

    return getEmployeeColor(appointment.employeeId);
  }, [getEmployeeColor, isAppointmentTentative]);

  const setNotice = (text: string, tone: MessageTone = 'info') => {
    setMessage(text);
    setMessageTone(tone);
    if (tone !== 'error') {
      sessionExpiredRef.current = false;
    } else if (text === t('notices.sessionExpired')) {
      sessionExpiredRef.current = true;
      operationErrorsRef.current = [];
      setOperationErrors([]);
    }
  };

  const applyAuthState = useCallback((nextAuth: AuthResponse | null) => {
    const previousAuth = authRef.current;
    const userChanged = previousAuth?.user.id !== nextAuth?.user.id;
    if (userChanged || previousAuth?.activeShopId !== nextAuth?.activeShopId) {
      shopContextVersionRef.current += 1;
      setReadErrors({});
      originalEditingStartAtRef.current = null;
      appointmentStartTimeEditedRef.current = false;
      clearStartTimeError();
      shopSelectionRequestIdRef.current += 1;
      phoneLookupRequestIdRef.current += 1;
      setPhoneLookupError(null);
      usersLoadedRef.current = false;
      appointmentsLoadedRef.current = false;
      calendarWindowLoadedRef.current = false;
      setCalendarWindowReady(false);
      auditLogsLoadedRef.current = false;
    }
    if (userChanged) {
      availableShopsUserIdRef.current = null;
      setAvailableShops([]);
    }
    if (nextAuth) {
      sessionExpiredRef.current = false;
    }
    authRef.current = nextAuth;
    setAuth(nextAuth);
    persistAuth(nextAuth);
  }, []);

  const clearAuthState = useCallback(() => {
    applyAuthState(null);
    setUsers([]);
    setAdminUsers([]);
    setAppointments([]);
    setForm(createInitialForm());
    originalEditingStartAtRef.current = null;
    appointmentStartTimeEditedRef.current = false;
    clearStartTimeError();
    phoneNameEditedRef.current = false;
    phoneNoteEditedRef.current = false;
    setEditingId(null);
    setAuditLogs([]);
    setAuditLogsTotal(0);
    setPasswordResetTargetUserId('');
  }, [applyAuthState]);

  const forceLogoutWithNotice = useCallback((notice: string) => {
    clearAuthState();
    setNotice(notice, 'error');
  }, [clearAuthState]);

  const beginShopSelection = useCallback(async (authForRequest: AuthResponse) => {
    const requestId = ++shopSelectionRequestIdRef.current;
    setShopSelection({ authForRequest, shops: [], loading: true, error: '' });
    try {
      const response = await fetch(`${API_BASE_URL}/shops`, {
        headers: { Authorization: `Bearer ${authForRequest.accessToken}` },
      });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data)) {
        throw new Error(data?.message ?? t('shopSelect.failedToLoad'));
      }
      if (requestId !== shopSelectionRequestIdRef.current) {
        return;
      }
      setAvailableShops(data);
      availableShopsUserIdRef.current = authForRequest.user.id;
      setReadErrors((current) => {
        if (!('shopNames' in current)) {
          return current;
        }
        const next = { ...current };
        delete next.shopNames;
        return next;
      });
      setShopSelection({ authForRequest, shops: data, loading: false, error: '' });
      setSelectedShopId((current) => (
        data.some((shop: ShopSummary) => shop.id === current) ? current : data[0]?.id || ''
      ));
    } catch (error) {
      if (requestId !== shopSelectionRequestIdRef.current) {
        return;
      }
      const errorMessage = error instanceof Error ? error.message : t('shopSelect.failedToLoad');
      setShopSelection({
        authForRequest,
        shops: [],
        loading: false,
        error: errorMessage,
      });
      showOperationError(errorMessage);
    }
  }, [showOperationError, t]);

  const confirmShopSelection = useCallback(async (shopId: string) => {
    const selection = shopSelection;
    if (!selection || selection.loading || !shopId) {
      return;
    }
    const requestId = shopSelectionRequestIdRef.current;
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/select-shop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${shopSelection.authForRequest.accessToken}`,
        },
        body: JSON.stringify({ shopId }),
      });
      const data = await response.json();
      if (!response.ok || !isAuthResponse(data)) {
        throw new Error(data?.message ?? t('shopSelect.failedToSelect'));
      }
      if (requestId !== shopSelectionRequestIdRef.current) {
        return;
      }
      applyAuthState(data);
      setShopSelection(null);
      setNotice(t('notices.signedInAs', { displayName: data.user.displayName }), 'success');
    } catch (error) {
      if (requestId !== shopSelectionRequestIdRef.current) {
        return;
      }
      const message = error instanceof Error ? error.message : t('shopSelect.failedToSelect');
      showOperationError(message);
    } finally {
      setLoading(false);
    }
  }, [applyAuthState, shopSelection, showOperationError, t]);

  const cancelShopSelection = useCallback(() => {
    shopSelectionRequestIdRef.current += 1;
    setShopSelection(null);
    setSelectedShopId('');
  }, []);

  const resolveStartTimeInput = useCallback((value: string) => {
    if (!calendarWindowReady) {
      return { status: 'window-unavailable' } as const;
    }

    const startMinutes = parseClockToMinutes(calendarWindow.slotMinTime);
    const endMinutes = parseClockToMinutes(calendarWindow.slotMaxTime);

    if (startMinutes === null || endMinutes === null) {
      return { status: 'window-unavailable' } as const;
    }

    return resolveAppointmentTimeInput(value, { startMinutes, endMinutes });
  }, [calendarWindow.slotMinTime, calendarWindow.slotMaxTime, calendarWindowReady]);

  const parseStartTimeInput = useCallback((value: string): ParsedFlexibleTimeInput | null => {
    const resolution = resolveStartTimeInput(value);
    return resolution.status === 'valid' ? resolution.parsed : null;
  }, [resolveStartTimeInput]);

  const allowCalendarStart = useCallback((start: Date) => {
    if (!calendarWindowReady) {
      showOperationError(t('notices.calendarWindowUnavailable'));
      return false;
    }
    if (!isCalendarStartWithinBusinessHours(start, calendarWindow)) {
      showOperationError(t('notices.outsideBusinessHours'));
      return false;
    }
    return true;
  }, [calendarWindow, calendarWindowReady, showOperationError, t]);

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

        if (parsed.needsShopSelection) {
          void beginShopSelection(parsed);
          return parsed;
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
  }, [applyAuthState, beginShopSelection, clearAuthState, t]);

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
    if (error instanceof Error && /appointment.*(?:conflict|overlap)|(?:conflict|overlap).*appointment/i.test(error.message)) {
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

  const isSameShopContext = (expectedAuth: AuthResponse | null) => {
    const currentAuth = authRef.current;
    return Boolean(
      authContextVersion === shopContextVersionRef.current
      &&
      expectedAuth
      && currentAuth
      && expectedAuth.user.id === currentAuth.user.id
      && expectedAuth.activeShopId === currentAuth.activeShopId,
    );
  };

  const setReadError = useCallback((key: ReadErrorKey, text: string) => {
    setReadErrors((current) => ({ ...current, [key]: text }));
  }, []);

  const clearReadError = useCallback((key: ReadErrorKey) => {
    setReadErrors((current) => {
      if (!(key in current)) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const reportReadFailure = useCallback((
    key: ReadErrorKey,
    error: unknown,
    fallbackKey: MessageKey,
    hasPreviouslyLoaded: boolean,
  ) => {
    const detail = getDisplayError(error, t(fallbackKey));
    if (detail === t('notices.sessionExpired')) {
      setNotice(detail, 'error');
      return;
    }

    const resourceKey = key === 'appointments'
      ? 'notices.resource.calendar'
      : key === 'users'
        ? 'notices.resource.employees'
        : key === 'calendarWindow'
          ? 'notices.resource.calendarSettings'
          : key === 'auditLogs'
            ? 'notices.resource.logs'
            : 'notices.resource.shopNames';
    const messageKey = hasPreviouslyLoaded
      ? 'notices.refreshFailedShowingStale'
      : 'notices.initialLoadFailed';
    setReadError(key, t(messageKey, {
      resource: t(resourceKey),
      error: detail,
    }));
  }, [setReadError, t]);

  const reportMutationRefreshFailure = useCallback((
    key: 'users' | 'appointments',
    error: unknown,
  ) => {
    const detail = getDisplayError(error, t('notices.failedLoadCalendar'));
    if (detail === t('notices.sessionExpired')) {
      setNotice(detail, 'error');
      return;
    }
    setReadError(key, t('notices.mutationSucceededRefreshFailed', { error: detail }));
  }, [setReadError, t]);

  const loadUsers = useCallback(async () => {
    const requestAuth = auth;
    if (!requestAuth || !isSameShopContext(requestAuth)) {
      return;
    }
    const data = await fetchJson('/users/staff');
    if (!isSameShopContext(requestAuth)) {
      return;
    }
    assertPersistedStaffColors(data, pendingAssignmentRuntime);
    setUsers(data);
    if (isAdminRole(requestAuth.user.role)) {
      const managedData = await fetchJson('/users');
      if (!isSameShopContext(requestAuth)) {
        return;
      }
      setAdminUsers(managedData);
    } else {
      setAdminUsers([]);
    }
    usersLoadedRef.current = true;
    clearReadError('users');
  }, [auth, clearReadError, pendingAssignmentRuntime]);

  const loadAppointments = useCallback(async () => {
    const requestAuth = auth;
    if (!requestAuth || !isSameShopContext(requestAuth)) {
      return;
    }
    const data = await fetchJson('/appointments');
    if (!isSameShopContext(requestAuth)) {
      return;
    }
    setAppointments(data);
    appointmentsLoadedRef.current = true;
    clearReadError('appointments');
  }, [auth, clearReadError]);

  const loadCalendarWindow = useCallback(async () => {
    const requestAuth = auth;
    if (!requestAuth || !isSameShopContext(requestAuth)) {
      return;
    }
    const formAtRequestStart = calendarWindowFormRef.current;
    const data = await fetchJson('/system-settings/calendar-window');
    if (!isSameShopContext(requestAuth)) {
      return;
    }
    if (!data || !isValidCalendarWindowRange(data.slotMinTime, data.slotMaxTime)) {
      throw new Error(t('notices.calendarWindowUnavailable'));
    }
    const normalized = normalizeCalendarWindowSettings(data);

    setCalendarWindow(normalized);
    setCalendarWindowForm((current) => ({
      slotMinTime: current.slotMinTime === formAtRequestStart.slotMinTime
        ? toCalendarTimeInputValue(normalized.slotMinTime)
        : current.slotMinTime,
      slotMaxTime: current.slotMaxTime === formAtRequestStart.slotMaxTime
        ? toCalendarTimeInputValue(normalized.slotMaxTime)
        : current.slotMaxTime,
    }));
    calendarWindowLoadedRef.current = true;
    setCalendarWindowReady(true);
    clearReadError('calendarWindow');
  }, [auth, clearReadError, t]);

  const loadAuditLogs = useCallback(async () => {
    const requestAuth = auth;
    if (!requestAuth || !isSameShopContext(requestAuth)) {
      return;
    }
    const data = await fetchJson('/audit/logs?page=1&limit=100') as AuditLogsResponse;
    if (!isSameShopContext(requestAuth)) {
      return;
    }
    setAuditLogs(data.items ?? []);
    setAuditLogsTotal(data.total ?? 0);
    auditLogsLoadedRef.current = true;
    clearReadError('auditLogs');
  }, [auth, clearReadError]);

  const loadShopNames = useCallback(async () => {
    const requestAuth = auth;
    if (!requestAuth || !canSwitchShopRole(requestAuth.user.role)) {
      return;
    }
    const requestId = ++shopNamesRequestIdRef.current;
    try {
      const data = await fetchJson('/shops');
      if (requestId !== shopNamesRequestIdRef.current || !isSameShopContext(requestAuth)) {
        return;
      }
      if (Array.isArray(data)) {
        setAvailableShops(data);
        availableShopsUserIdRef.current = requestAuth.user.id;
        clearReadError('shopNames');
      }
    } catch (error) {
      if (requestId !== shopNamesRequestIdRef.current || !isSameShopContext(requestAuth)) {
        return;
      }
      throw error;
    }
  }, [auth, clearReadError]);

  const scheduleAppointmentsRefresh = useCallback(() => {
    if (refreshDebounceRef.current) {
      window.clearTimeout(refreshDebounceRef.current);
    }

    refreshDebounceRef.current = window.setTimeout(() => {
      void loadAppointments().catch(error => {
        if (isSameShopContext(auth)) {
          reportReadFailure('appointments', error, 'notices.failedLoadCalendar', appointmentsLoadedRef.current);
        }
      });
    }, 200);
  }, [auth, loadAppointments, reportReadFailure]);

  useEffect(() => {
    if (!auth || !canSwitchShopRole(auth.user.role)) {
      return;
    }
    void loadShopNames().catch((error) => {
      if (isSameShopContext(auth)) {
        reportReadFailure('shopNames', error, 'notices.failedLoadShopNames', availableShopsUserIdRef.current === auth.user.id);
      }
    });
    return () => {
      shopNamesRequestIdRef.current += 1;
    };
  }, [auth, loadShopNames, reportReadFailure]);

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
    void loadUsers().catch((error) => {
      if (isSameShopContext(auth)) {
        reportReadFailure('users', error, 'notices.failedLoadCalendar', usersLoadedRef.current);
      }
    });
    void loadAppointments().catch((error) => {
      if (isSameShopContext(auth)) {
        reportReadFailure('appointments', error, 'notices.failedLoadCalendar', appointmentsLoadedRef.current);
      }
    });
    void loadCalendarWindow().catch((error) => {
      if (isSameShopContext(auth)) {
        reportReadFailure('calendarWindow', error, 'notices.failedLoadCalendar', calendarWindowLoadedRef.current);
      }
    });
  }, [auth, loadAppointments, loadCalendarWindow, loadUsers, reportReadFailure]);

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
    if (!auth || (!isAdminRole(auth.user.role) && !isManagerRole(auth.user.role)) || adminPanel !== 'logs') {
      return;
    }

    setLogsLoading(true);
    void loadAuditLogs()
      .catch((error) => {
        if (isSameShopContext(auth)) {
          reportReadFailure('auditLogs', error, 'notices.failedLoadLogs', auditLogsLoadedRef.current);
        }
      })
      .finally(() => {
        setLogsLoading(false);
      });
  }, [auth, adminPanel, loadAuditLogs, reportReadFailure]);

  const retryRead = useCallback(async (key: ReadErrorKey) => {
    const requestAuth = auth;
    if (!requestAuth) {
      return;
    }

    try {
      if (key === 'users') {
        await loadUsers();
      } else if (key === 'appointments') {
        await loadAppointments();
      } else if (key === 'calendarWindow') {
        await loadCalendarWindow();
      } else if (key === 'auditLogs') {
        await loadAuditLogs();
      } else {
        await loadShopNames();
      }
    } catch (error) {
      if (!isSameShopContext(requestAuth)) {
        return;
      }
      const fallbackKey = key === 'auditLogs'
        ? 'notices.failedLoadLogs'
        : key === 'shopNames'
          ? 'notices.failedLoadShopNames'
          : 'notices.failedLoadCalendar';
      const hasLoaded = key === 'users'
        ? usersLoadedRef.current
        : key === 'appointments'
          ? appointmentsLoadedRef.current
          : key === 'calendarWindow'
            ? calendarWindowLoadedRef.current
            : key === 'auditLogs'
              ? auditLogsLoadedRef.current
              : availableShopsUserIdRef.current === requestAuth.user.id;
      reportReadFailure(key, error, fallbackKey, hasLoaded);
    }
  }, [auth, loadAppointments, loadAuditLogs, loadCalendarWindow, loadShopNames, loadUsers, reportReadFailure]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    sessionExpiredRef.current = false;
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

      if (data.needsShopSelection) {
        await beginShopSelection(data);
        return;
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
    setShopSelection(null);
    setNotice(t('notices.signedOut'), 'info');
  };

  const handleSwitchShop = () => {
    if (!auth) {
      return;
    }
    void beginShopSelection(auth);
  };

  const handleCreateOrUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth) {
      return;
    }

    const partySize = Math.max(1, parseInt(form.partySize, 10) || 1);
    const selectedEmployeeIds = form.employeeIds.filter(
      (employeeId) => !pendingEmployee || employeeId !== pendingEmployee.id,
    );

    if (!form.startDate || !form.startTime || !form.phone) {
      showOperationError(t('notices.fillRequired'));
      return;
    }

    if (!form.durationMinutes.trim()) {
      showOperationError(t('notices.durationRequired'));
      return;
    }

    const durationMinutes = parseDurationMinutes(form.durationMinutes);
    if (durationMinutes === null) {
      showOperationError(t('notices.durationInvalid'));
      return;
    }

    if (!/^\d{10}$/.test(form.phone)) {
      showOperationError(t('notices.phoneInvalid'));
      return;
    }

    const priceUnchanged = Boolean(editingId) && form.price === originalEditingPrice;
    if (!priceUnchanged && form.price.trim() && !/^\d+$/.test(form.price)) {
      showOperationError(t('notices.priceInvalid'));
      return;
    }

    if (form.startDate && !parseUsDateInput(form.startDate)) {
      showOperationError(t('notices.startDateInvalid'));
      return;
    }

    const originalStartAt = editingId && !appointmentStartTimeEditedRef.current
      ? originalEditingStartAtRef.current
      : null;
    if (rejectedStartTimeInputRef.current) {
      showOperationError(t('notices.startTimeInvalid'));
      return;
    }
    const preservedStartAt = originalStartAt
      ? preserveAppointmentTimeForDate(form.startDate, originalStartAt)
      : null;
    let startAt = preservedStartAt;
    if (!startAt) {
      const timeResolution = resolveStartTimeInput(form.startTime);
      if (timeResolution.status !== 'valid') {
        const errorKey = startTimeErrorKey(timeResolution.status);
        setStartTimeError(errorKey);
        showOperationError(t(errorKey, {
          start: calendarWindow.slotMinTime.slice(0, 5),
          end: calendarWindow.slotMaxTime.slice(0, 5),
        }));
        return;
      }

      startAt = buildLocalDateTime(
        form.startDate,
        form.startTime,
        () => timeResolution.parsed,
      );
      if (startAt) {
        setForm((current) => current.startTime === form.startTime
          ? { ...current, startTime: timeResolution.parsed.normalized }
          : current);
      }
    }
    if (!startAt) {
      showOperationError(t('notices.startDateTimeInvalid'));
      return;
    }

    if (
      !editingId &&
      isLocalDateTimeInPast(startAt) &&
      !canManageAppointmentsRole(auth.user.role)
    ) {
      showOperationError(t('notices.startInPast'));
      return;
    }

    const endAt = computeEndFromDuration(startAt, durationMinutes);
    if (crossesIntoNextDay(startAt, endAt)) {
      showOperationError(t('notices.endNextDay'));
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
      showOperationError(t('notices.rangeInvalid'));
      return;
    }

    setLoading(true);
    setNotice('');
    try {
      const payload = {
        employeeIds: selectedEmployeeIds,
        partySize,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        phone: form.phone,
        price: !priceUnchanged && form.price.trim() ? form.price : undefined,
        customerName: form.customerName || undefined,
        note: form.note || undefined,
        createdById: auth.user.id,
        updatedById: auth.user.id,
      };

      const successMessage = editingId
        ? t('notices.appointmentUpdated')
        : t('notices.appointmentCreated');
      try {
        if (editingId) {
          await fetchJson(`/appointments/${editingId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
        } else {
          await fetchJson('/appointments', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
        }
      } catch (error) {
        if (isSameShopContext(auth)) {
          showOperationError(getDisplayError(error, t('notices.saveFailed')));
        }
        return;
      }

      if (!isSameShopContext(auth)) {
        return;
      }
      setForm(createInitialForm());
      phoneNameEditedRef.current = false;
      phoneNoteEditedRef.current = false;
      setEditingId(null);
      originalEditingStartAtRef.current = null;
      appointmentStartTimeEditedRef.current = false;
      clearStartTimeError();
      setNotice(successMessage, 'success');
      try {
        await loadAppointments();
      } catch (error) {
        if (isSameShopContext(auth)) {
          reportMutationRefreshFailure('appointments', error);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = async (appointment: AppointmentRecord) => {
    const requestAuth = authRef.current;
    try {
      const groupMembers = appointment.groupId
        ? ((await fetchJson(`/appointments?groupId=${appointment.groupId}`)) as AppointmentRecord[])
        : [appointment];
      if (!isSameShopContext(requestAuth)) {
        return;
      }
      phoneNameEditedRef.current = true;
      phoneNoteEditedRef.current = true;
      originalEditingStartAtRef.current = new Date(appointment.startAt);
      appointmentStartTimeEditedRef.current = false;
      clearStartTimeError();
      setEditingId(appointment.id);
      const editingPrice = appointment.price.replace(/\.00$/, '');
      setOriginalEditingPrice(editingPrice);
      setNotice(t('notices.editingExisting'), 'info');
      const startAt = new Date(appointment.startAt);
      const endAt = new Date(appointment.endAt);

      const realMembers = groupMembers.filter(
        (member) => !pendingEmployee || member.employeeId !== pendingEmployee.id,
      );

      setForm({
        employeeIds: realMembers.map((member) => member.employeeId),
        partySize: String(groupMembers.length || 1),
        startDate: formatDateForUsInput(startAt),
        startTime: formatAppointmentTimeInput(startAt),
        durationMinutes: String(
          computeDurationBetweenMinutes(startAt, endAt) ?? DEFAULT_APPOINTMENT_DURATION_MINUTES,
        ),
        phone: appointment.phone,
        price: editingPrice,
        customerName: appointment.customerName ?? '',
        note: appointment.note ?? '',
      });
    } catch (error) {
      if (isSameShopContext(requestAuth)) {
        showOperationError(getDisplayError(error, t('notices.failedLoadAppointment')));
      }
    }
  };

  const handleDelete = async (appointmentId: string) => {
    if (!auth || !canManageAppointmentsRole(auth.user.role)) {
      return;
    }

    const confirmed = window.confirm(t('confirm.deleteAppointmentAdmin'));
    if (!confirmed) {
      setNotice(t('notices.actionCancelled'), 'info');
      return;
    }

    setLoading(true);
    try {
      await fetchJson(`/appointments/${appointmentId}`, {
        method: 'DELETE',
      });
      if (!isSameShopContext(auth)) {
        return;
      }
      if (editingId === appointmentId) {
        setEditingId(null);
        setForm(createInitialForm());
        originalEditingStartAtRef.current = null;
        appointmentStartTimeEditedRef.current = false;
        clearStartTimeError();
        phoneNameEditedRef.current = false;
        phoneNoteEditedRef.current = false;
      }
      setNotice(t('notices.appointmentDeleted'), 'success');
      try {
        await loadAppointments();
      } catch (error) {
        if (isSameShopContext(auth)) {
          reportMutationRefreshFailure('appointments', error);
        }
      }
    } catch (error) {
      if (isSameShopContext(auth)) {
        showOperationError(getDisplayError(error, t('notices.deleteFailed')));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancelAppointment = async (appointmentId: string) => {
    if (!auth) return;
    if (!window.confirm(t('confirm.deleteAppointmentEmployee'))) {
      setNotice(t('notices.actionCancelled'), 'info');
      return;
    }

    setLoading(true);
    try {
      await fetchJson(`/appointments/${appointmentId}/cancel`, { method: 'POST' });
      if (!isSameShopContext(auth)) return;
      if (editingId === appointmentId) {
        setEditingId(null);
        setForm(createInitialForm());
        originalEditingStartAtRef.current = null;
        appointmentStartTimeEditedRef.current = false;
        clearStartTimeError();
        phoneNameEditedRef.current = false;
        phoneNoteEditedRef.current = false;
      }
      setNotice(t('notices.appointmentCancelled'), 'success');
      try {
        await loadAppointments();
      } catch (error) {
        if (isSameShopContext(auth)) reportMutationRefreshFailure('appointments', error);
      }
    } catch (error) {
      if (isSameShopContext(auth)) {
        showOperationError(getDisplayError(error, t('notices.deleteFailed')));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAdminCreateUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth || !isAdminRole(auth.user.role)) {
      return;
    }
    const username = adminCreateUserForm.username.trim();
    const password = adminCreateUserForm.password;
    const confirmPassword = adminCreateUserForm.confirmPassword;
    const displayName = adminCreateUserForm.displayName.trim() || username;
    const role = adminCreateUserForm.role;

    if (password !== confirmPassword) {
      showOperationError(t('notices.passwordMismatch'));
      return;
    }

    setLoading(true);
    try {
      await fetchJson('/users', {
        method: 'POST',
        body: JSON.stringify({ username, password, displayName, role }),
      });
      if (!isSameShopContext(auth)) {
        return;
      }
      setAdminCreateUserForm(createInitialAdminCreateUserForm());
      const successMessage = t('notices.employeeCreated');
      setNotice(successMessage, 'success');
      try {
        await loadUsers();
      } catch (error) {
        if (isSameShopContext(auth)) {
          reportMutationRefreshFailure('users', error);
        }
      }
    } catch (error) {
      if (isSameShopContext(auth)) {
        showOperationError(getDisplayError(error, t('notices.userCreationFailed')));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAdminResetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth || !isAdminRole(auth.user.role)) {
      return;
    }

    const formElement = event.currentTarget as HTMLFormElement;
    const formData = new FormData(formElement);
    const targetUserId = String(formData.get('targetUserId') ?? '').trim();
    const newPassword = String(formData.get('newPassword') ?? '');
    const confirmPassword = String(formData.get('confirmPassword') ?? '');

    if (!targetUserId) {
      showOperationError(t('notices.passwordTargetRequired'));
      return;
    }

    if (newPassword !== confirmPassword) {
      showOperationError(t('notices.passwordMismatch'));
      return;
    }

    setLoading(true);
    try {
      await fetchJson(`/users/${targetUserId}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ newPassword }),
      });

      const targetUser = adminUsers.find((user) => user.id === targetUserId);
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
      showOperationError(getDisplayError(error, t('notices.passwordUpdateFailed')));
    } finally {
      setLoading(false);
    }
  };

  const handleCalendarWindowSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth || !isAdminRole(auth.user.role)) {
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
      showOperationError(getDisplayError(error, t('notices.windowSaveFailed')));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleUserStatus = async (userId: string, nextStatus: UserStatusValue) => {
    if (!auth || !isAdminRole(auth.user.role)) {
      return;
    }
    setLoading(true);
    try {
      await fetchJson(`/users/${userId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!isSameShopContext(auth)) {
        return;
      }
      const successMessage = nextStatus === 'ACTIVE'
        ? t('notices.userEnabled')
        : t('notices.userDisabled');
      setNotice(successMessage, 'success');
      try {
        await loadUsers();
      } catch (error) {
        if (isSameShopContext(auth)) {
          reportMutationRefreshFailure('users', error);
        }
      }
    } catch (error) {
      if (isSameShopContext(auth)) {
        showOperationError(getDisplayError(error, t('notices.statusUpdateFailed')));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveUser = async (user: UserRecord) => {
    if (!auth || !isAdminRole(auth.user.role)) {
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
      if (!isSameShopContext(auth)) {
        return;
      }
      const successMessage = t('notices.userRemoved');
      setNotice(successMessage, 'success');
      try {
        await loadUsers();
      } catch (error) {
        if (isSameShopContext(auth)) {
          reportMutationRefreshFailure('users', error);
        }
      }
    } catch (error) {
      if (isSameShopContext(auth)) {
        showOperationError(getDisplayError(error, t('notices.userRemovalFailed')));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCalendarDrop = async (info: any) => {
    if (!auth) {
      return;
    }
    let appointmentId = '';
    try {
      appointmentId = info.event.extendedProps?.appointmentId ?? info.event.id;
      await fetchJson(`/appointments/${appointmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          startAt: info.event.start?.toISOString(),
          endAt: info.event.end?.toISOString(),
          updatedById: auth.user.id,
        }),
      });
    } catch (error) {
      info.revert();
      if (isSameShopContext(auth)) {
        showOperationError(getDisplayError(error, t('notices.moveFailed')));
      }
      return;
    }

    if (!isSameShopContext(auth)) {
      return;
    }
    try {
      await loadAppointments();
    } catch (error) {
      if (isSameShopContext(auth)) {
        reportMutationRefreshFailure('appointments', error);
      }
    }
  };

  const handleCalendarResize = async (info: any) => {
    if (!auth) {
      return;
    }
    let appointmentId = '';
    try {
      appointmentId = info.event.extendedProps?.appointmentId ?? info.event.id;
      await fetchJson(`/appointments/${appointmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          startAt: info.event.start?.toISOString(),
          endAt: info.event.end?.toISOString(),
          updatedById: auth.user.id,
        }),
      });
    } catch (error) {
      info.revert();
      if (isSameShopContext(auth)) {
        showOperationError(getDisplayError(error, t('notices.resizeFailed')));
      }
      return;
    }

    if (!isSameShopContext(auth)) {
      return;
    }
    try {
      await loadAppointments();
    } catch (error) {
      if (isSameShopContext(auth)) {
        reportMutationRefreshFailure('appointments', error);
      }
    }
  };

  const handleDateClick = (info: DateClickArg) => {
    if (!allowCalendarStart(info.date)) {
      return;
    }
    setEditingId(null);
    originalEditingStartAtRef.current = null;
    appointmentStartTimeEditedRef.current = false;
    clearStartTimeError();
    setNotice(t('notices.newDraft'), 'info');
    setForm((current) => applySlotClickToForm(current, info.date));
  };

  const applyToday = useCallback(() => {
    setForm((current) => ({ ...current, startDate: formatDateForUsInput(new Date()) }));
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
    const originalStartAt = editingId && !appointmentStartTimeEditedRef.current
      ? originalEditingStartAtRef.current
      : null;
    const startAt = originalStartAt
      ? preserveAppointmentTimeForDate(form.startDate, originalStartAt)
      : buildLocalDateTime(form.startDate, form.startTime, parseStartTimeInput);

    if (!startAt || durationMinutes === null) {
      return { text: null, crossesDay: false };
    }

    const endAt = computeEndFromDuration(startAt, durationMinutes);
    const crossesDay = crossesIntoNextDay(startAt, endAt);

    return {
      text: t('editor.previewDerived', { value: formatDateTimeForPreview(endAt, locale) }),
      crossesDay,
    };
  }, [editingId, form.durationMinutes, form.startDate, form.startTime, locale, parseStartTimeInput, t]);

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

  const isSelectedAppointmentCancelled = useMemo(
    () => (selectedAppointmentContext ? isCancelledAppointment(selectedAppointmentContext) : false),
    [selectedAppointmentContext],
  );

  useEffect(() => {
    if (!editingId) {
      return;
    }

    const stillExists = appointments.some((appointment) => appointment.id === editingId);
    if (!stillExists) {
      setEditingId(null);
      setForm(createInitialForm());
      originalEditingStartAtRef.current = null;
      appointmentStartTimeEditedRef.current = false;
      clearStartTimeError();
      phoneNameEditedRef.current = false;
      phoneNoteEditedRef.current = false;
      setNotice(t('notices.selectedRemoved'), 'info');
    }
  }, [appointments, editingId, t]);

  const displayPhoneValue = useMemo(() => formatPhoneForDisplay(form.phone), [form.phone]);

  const handlePhoneInputChange = useCallback((value: string) => {
    const phone = normalizePhoneInput(value);
    if (phone !== formRef.current.phone) {
      phoneLookupRequestIdRef.current += 1;
      setPhoneLookupError(null);
    }
    setForm((current) => ({
      ...current,
      phone,
    }));
  }, []);

  const commitPhoneInputEdit = useCallback((edit: ReturnType<typeof applyPhoneInputEdit>) => {
    if (!edit.changed) {
      const input = phoneInputRef.current;
      if (input) {
        input.value = formatPhoneForDisplay(edit.digits);
        input.setSelectionRange(edit.selectionStart, edit.selectionEnd);
      }
      return;
    }

    pendingPhoneSelectionRef.current = {
      digits: edit.digits,
      selectionStart: edit.selectionStart,
      selectionEnd: edit.selectionEnd,
    };
    handlePhoneInputChange(edit.digits);
  }, [handlePhoneInputChange]);

  const handlePhoneBeforeInput = useCallback((input: HTMLInputElement, nativeEvent: InputEvent) => {
    if (nativeEvent.isComposing) {
      return;
    }

    const selectionStart = input.selectionStart ?? input.value.length;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    const inputType = nativeEvent.inputType ?? '';
    const data = nativeEvent.data
      || nativeEvent.dataTransfer?.getData('text/plain')
      || nativeEvent.dataTransfer?.getData('text')
      || phonePasteDataRef.current;
    phonePasteDataRef.current = null;
    const snapshot = {
      digits: formRef.current.phone,
      selectionStart,
      selectionEnd,
      inputType,
      data,
    };
    phoneBeforeInputRef.current = snapshot;

    if (nativeEvent.cancelable && (inputType.startsWith('delete') || inputType.startsWith('insert'))) {
      nativeEvent.preventDefault();
      phoneBeforeInputRef.current = null;
      commitPhoneInputEdit(applyPhoneInputEdit(
        snapshot.digits,
        input.value,
        selectionStart,
        selectionEnd,
        inputType,
        data,
      ));
    }
  }, [commitPhoneInputEdit]);

  const handlePhonePaste = useCallback((event: React.ClipboardEvent<HTMLInputElement>) => {
    phonePasteDataRef.current = event.clipboardData.getData('text/plain')
      || event.clipboardData.getData('text')
      || null;
  }, []);

  phoneBeforeInputHandlerRef.current = handlePhoneBeforeInput;
  const attachPhoneInput = useCallback((input: HTMLInputElement | null) => {
    const previousInput = phoneInputRef.current;
    const previousListener = phoneBeforeInputListenerRef.current;
    if (previousInput && previousListener) {
      previousInput.removeEventListener('beforeinput', previousListener);
    }

    phoneInputRef.current = input;
    phoneBeforeInputListenerRef.current = null;
    if (!input) {
      return;
    }

    const listener: EventListener = (event) => {
      phoneBeforeInputHandlerRef.current?.(input, event as InputEvent);
    };
    phoneBeforeInputListenerRef.current = listener;
    input.addEventListener('beforeinput', listener);
  }, []);

  const reconcilePhoneInputChange = useCallback((
    input: HTMLInputElement,
    inputType = '',
    isComposing = false,
  ) => {
    if (isComposing) {
      return;
    }

    phonePasteDataRef.current = null;
    const snapshot = phoneBeforeInputRef.current;
    phoneBeforeInputRef.current = null;
    const currentDigits = snapshot?.digits ?? formRef.current.phone;
    const selectionStart = input.selectionStart ?? input.value.length;

    if (
      snapshot
      && snapshot.digits === formRef.current.phone
      && (!inputType || inputType === snapshot.inputType)
    ) {
      const operationType = snapshot.inputType;
      const edit = operationType.startsWith('delete')
        || (operationType.startsWith('insert') && snapshot.data !== null)
        ? applyPhoneInputEdit(
          snapshot.digits,
          formatPhoneForDisplay(snapshot.digits),
          snapshot.selectionStart,
          snapshot.selectionEnd,
          operationType,
          snapshot.data,
        )
        : reconcilePhoneInputValue(currentDigits, input.value, selectionStart);
      commitPhoneInputEdit(edit);
      return;
    }

    commitPhoneInputEdit(reconcilePhoneInputValue(currentDigits, input.value, selectionStart));
  }, [commitPhoneInputEdit]);

  useEffect(() => {
    if (editingId || !auth?.accessToken || !/^\d{10}$/.test(form.phone)) {
      return;
    }

    const requestId = ++phoneLookupRequestIdRef.current;
    const requestAuth = auth;
    const requestedPhone = form.phone;
    const requestedName = form.customerName;
    const requestedNote = form.note;
    let active = true;
    void fetchJson(`/appointments/customer-lookup?phone=${encodeURIComponent(requestedPhone)}`)
      .then((customer: { customerName?: string | null; note?: string | null }) => {
        if (
          !active
          || requestId !== phoneLookupRequestIdRef.current
          || !isSameShopContext(requestAuth)
          || formRef.current.phone !== requestedPhone
        ) {
          return;
        }

        setForm((current) => ({
          ...current,
          customerName: !phoneNameEditedRef.current && current.customerName === requestedName
            ? customer.customerName ?? current.customerName
            : current.customerName,
          note: !phoneNoteEditedRef.current && current.note === requestedNote
            ? customer.note ?? current.note
            : current.note,
        }));
        setPhoneLookupError(null);
      })
      .catch((error) => {
        if (
          !active
          || requestId !== phoneLookupRequestIdRef.current
          || !isSameShopContext(requestAuth)
          || formRef.current.phone !== requestedPhone
        ) {
          return;
        }
        const detail = getDisplayError(error, t('notices.phoneLookupFailed'));
        if (detail === t('notices.sessionExpired')) {
          return;
        }
        setPhoneLookupError({
          phone: requestedPhone,
          shopId: requestAuth.activeShopId ?? null,
          message: t('notices.phoneLookupFailedDetail', { error: detail }),
        });
      });

    return () => {
      active = false;
    };
  }, [auth, editingId, form.phone, phoneLookupRetry, t]);

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
      return adminUsers.filter((user) => !isPendingAssignmentEmployee(user, pendingAssignmentRuntime));
    }

    return adminUsers.filter((user) => user.id !== auth.user.id && !isPendingAssignmentEmployee(user, pendingAssignmentRuntime));
  }, [adminUsers, auth, pendingAssignmentRuntime]);

  const passwordResetUsers = useMemo(
    () => adminUsers.filter((user) => !isPendingAssignmentEmployee(user, pendingAssignmentRuntime)),
    [adminUsers, pendingAssignmentRuntime],
  );

  const handleRefreshLogs = useCallback(async () => {
    if (!auth || (!isAdminRole(auth.user.role) && !isManagerRole(auth.user.role))) {
      return;
    }

    setLogsLoading(true);
    try {
      await loadAuditLogs();
      setNotice(t('notices.logsRefreshed'), 'success');
    } catch (error) {
      showOperationError(getDisplayError(error, t('notices.refreshLogsFailed')));
    } finally {
      setLogsLoading(false);
    }
  }, [auth, loadAuditLogs, showOperationError, t]);

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

  const handleCalendarDateChoose = useCallback((value: string) => {
    const localDate = parseUsDateInput(value);
    const api = calendarRef.current?.getApi();
    if (!localDate || !api) return;
    api.gotoDate(localDate);
    setSelectedDate(new Date(api.getDate()));
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
      api.gotoDate(new Date());
    }

    setSelectedDate(new Date(api.getDate()));
  }, []);

  const renderCalendarEventContent = useCallback((eventContent: EventContentArg) => {
    const note = resolveCalendarEventNote(eventContent.event);
    const isCancelled = String(eventContent.event.extendedProps.status ?? '').trim().toUpperCase() === 'CANCELLED';
    const start = eventContent.event.start;
    // Appointment end is required by the domain. Never display FullCalendar's
    // default duration as a real end when a malformed record is missing endAt.
    const actualEndAt = eventContent.event.extendedProps.actualEndAt;
    const end = actualEndAt ? eventContent.event.end : null;
    return (
      <CalendarEventBox start={start} end={end} locale={locale}
        title={eventContent.event.title} note={note}
        cancelledLabel={isCancelled ? t('status.cancelled') : undefined} />
    );
  }, [t, locale]);

  const calendarNoteTooltipText = useMemo<CalendarNoteTooltipText>(() => ({
    closeButtonLabel: t('tooltip.close'),
    closeBackdropAriaLabel: t('tooltip.closeNoteDetails'),
  }), [t]);

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

    const cleanup = bindCalendarEventNoteTooltip(noteElement, noteText, calendarNoteTooltipText);
    calendarEventTooltipCleanupRef.current.set(mountInfo.el, cleanup);
  }, [calendarNoteTooltipText]);

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
        const employeeColor = getAppointmentColor(appointment);
        const isPendingAssignment = isAppointmentTentative(appointment);
        const isCancelled = isCancelledAppointment(appointment);
        const normalizedNote = appointment.note?.trim();
        const titleParts = [getAppointmentDisplayName(appointment), appointment.customerName ?? ''];
        const backgroundColor = isCancelled
          ? CANCELLED_APPOINTMENT_BACKGROUND
          : isPendingAssignment
          ? `color-mix(in srgb, ${CALENDAR_EVENT_BACKGROUND_DARK} ${100 - CALENDAR_PENDING_EVENT_TINT}%, ${DEFAULT_PENDING_EMPLOYEE_COLOR} ${CALENDAR_PENDING_EVENT_TINT}%)`
          : `color-mix(in srgb, ${CALENDAR_EVENT_BACKGROUND_DARK} ${100 - CALENDAR_EVENT_EMPLOYEE_TINT}%, ${employeeColor} ${CALENDAR_EVENT_EMPLOYEE_TINT}%)`;
        const classNames = [
          isPendingAssignment ? 'calendar-event-pending-assignment' : 'calendar-event-assigned',
          isCancelled ? 'calendar-event-cancelled' : '',
        ].filter(Boolean);
        return {
          id: appointment.id,
          title: titleParts.filter(Boolean).join(' • '),
          start: appointment.startAt,
          end: appointment.endAt,
          backgroundColor,
          borderColor: isCancelled ? CANCELLED_APPOINTMENT_ACCENT : employeeColor,
          textColor: isCancelled ? '#e2e8f0' : CALENDAR_EVENT_TEXT_LIGHT,
          borderWidth: '1px',
          display: 'block',
          editable: !isCancelled,
          classNames,
          extendedProps: {
            appointmentId: appointment.id,
            actualEndAt: appointment.endAt,
            employeeId: appointment.employeeId,
            employeeName: getAppointmentDisplayName(appointment),
            status: appointment.status,
            note: normalizedNote,
            remark: normalizedNote,
            description: normalizedNote,
            memo: normalizedNote,
            comment: normalizedNote,
          },
        };
      });
  }, [filteredAppointments, getAppointmentColor, getAppointmentDisplayName, isAppointmentTentative]);

  const primaryCalendarControl = getPrimaryCalendarControl(isMobileCalendarLayout);
  const primaryCalendarControlLabel = primaryCalendarControl.view === 'timeGridThreeDay'
    ? t('calendar.viewThreeDay')
    : t('calendar.viewWeek');

  if (isAuthBootstrapping) {
    return (
      <div className="app-shell">
        <OperationErrorDialog message={operationError} onClose={closeOperationError} />
        <div className="card">
          <h1>{t('app.title')}</h1>
          <p>{t('login.signingIn')}</p>
        </div>
      </div>
    );
  }

  if (!auth && shopSelection) {
    return (
      <div className="app-shell">
        <OperationErrorDialog message={operationError} onClose={closeOperationError} />
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="card">
            <h1>{t('app.title')}</h1>
            <h2>{t('shopSelect.title')}</h2>
            <p>{t('shopSelect.subtitle')}</p>
            {shopSelection.loading ? (
              <p>{t('shopSelect.loading')}</p>
            ) : (
              <div className="stack">
                <div className="shop-option-list" role="listbox" aria-label={t('shopSelect.title')}>
                  {shopSelection.shops.map((shop) => (
                    <button
                      key={shop.id}
                      type="button"
                      className={`shop-option-button${selectedShopId === shop.id ? ' active' : ''}`}
                      aria-pressed={selectedShopId === shop.id}
                      onClick={() => setSelectedShopId(shop.id)}
                    >
                      {shop.name}
                    </button>
                  ))}
                </div>
                {!shopSelection.shops.length ? (
                  <>
                    {!shopSelection.error ? <p className="hint">{t('shopSelect.noShopsAvailable')}</p> : null}
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void beginShopSelection(shopSelection.authForRequest)}
                    >
                      {t('shopSelect.retry')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={loading || !selectedShopId}
                    onClick={() => void confirmShopSelection(selectedShopId)}
                  >
                    {t('shopSelect.confirm')}
                  </button>
                )}
              </div>
            )}
            <button type="button" onClick={cancelShopSelection}>{t('shopSelect.returnToSignIn')}</button>
            {message ? <p className={`message ${messageTone}`}>{message}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  if (!auth) {
    return (
      <div className="app-shell">
        <OperationErrorDialog message={operationError} onClose={closeOperationError} />
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

  const isAdmin = isAdminRole(auth.user.role);
  const isManager = isManagerRole(auth.user.role);
  const canViewOverviewAndLogs = isAdmin || isManager;
  const canSwitchShop = canSwitchShopRole(auth.user.role);
  const showCalendarPanel = !canViewOverviewAndLogs || adminPanel === 'calendar';
  const showOverviewPanel = canViewOverviewAndLogs && adminPanel === 'overview';
  const showAdminPanel = isAdmin && adminPanel === 'admin';
  const showLogsPanel = canViewOverviewAndLogs && adminPanel === 'logs';
  const currentShopName = (
    availableShopsUserIdRef.current === auth.user.id
      ? availableShops.find((shop) => shop.id === auth.activeShopId)?.name
      : undefined
  ) ?? auth.activeShopId ?? '';
  const currentPhoneLookupError = phoneLookupError?.phone === form.phone
    && phoneLookupError.shopId === auth.activeShopId
    ? phoneLookupError
    : null;

  return (
    <div className="app-shell">
      <OperationErrorDialog message={operationError} onClose={closeOperationError} />
      {shopSelection ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="card">
            <h2>{t('shopSelect.title')}</h2>
            <p>{t('shopSelect.subtitle')}</p>
            {shopSelection.loading ? (
              <p>{t('shopSelect.loading')}</p>
            ) : (
              <div className="stack">
                <div className="shop-option-list" role="listbox" aria-label={t('shopSelect.title')}>
                  {shopSelection.shops.map((shop) => (
                    <button
                      key={shop.id}
                      type="button"
                      className={`shop-option-button${selectedShopId === shop.id ? ' active' : ''}`}
                      aria-pressed={selectedShopId === shop.id}
                      onClick={() => setSelectedShopId(shop.id)}
                    >
                      {shop.name}
                    </button>
                  ))}
                </div>
                <div className="stack-row">
                  {shopSelection.shops.length ? (
                    <button
                      type="button"
                      disabled={loading || !selectedShopId}
                      onClick={() => void confirmShopSelection(selectedShopId)}
                    >
                      {t('shopSelect.confirm')}
                    </button>
                  ) : (
                    <>
                      {!shopSelection.error ? <p className="hint">{t('shopSelect.noShopsAvailable')}</p> : null}
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void beginShopSelection(shopSelection.authForRequest)}
                      >
                        {t('shopSelect.retry')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
            <button type="button" onClick={cancelShopSelection}>{t('shopSelect.cancel')}</button>
          </div>
        </div>
      ) : null}
      {(Object.entries(readErrors) as [ReadErrorKey, string][])
        .filter(([key]) => !(shopSelection && key === 'shopNames'))
        .map(([key, text]) => (
        <div className="message error read-recovery-banner" role="alert" key={key}>
          <span>{text}</span>
          <button type="button" onClick={() => void retryRead(key)}>{t('actions.retry')}</button>
        </div>
      ))}
      <header className="topbar">
        <div>
          <h1>{t('app.title')}</h1>
          <p>{t('topbar.signedInAs', {
            displayName: auth.user.displayName,
            role: ROLE_MESSAGES[auth.user.role] ? t(ROLE_MESSAGES[auth.user.role]) : auth.user.role,
          })}</p>
        </div>
        <div className="topbar-actions">
          {canSwitchShop ? (
            <button type="button" onClick={handleSwitchShop}>
              {t('topbar.switchShop', { shopName: currentShopName })}
            </button>
          ) : null}
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

      {canViewOverviewAndLogs ? (
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
          {isAdmin ? <button
            type="button"
            className={adminPanel === 'admin' ? 'active' : ''}
            aria-selected={adminPanel === 'admin'}
            onClick={() => setAdminPanel('admin')}
          >
            {t('tabs.admin')}
          </button> : null}
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
                    <span><strong>{getAppointmentDisplayName(selectedAppointmentContext)}</strong></span>
                    <span>{t('overview.badgePhone', { value: selectedAppointmentContext.phone })}</span>
                    <span>{formatAppointmentWindow(selectedAppointmentContext.startAt, selectedAppointmentContext.endAt, locale)}</span>
                  </div>
                </div>
              ) : null}
              <form onInvalidCapture={event => {
                event.preventDefault();
                showOperationError((event.target as HTMLInputElement).validationMessage);
              }} onSubmit={handleCreateOrUpdate} className="stack">
                <div className="row party-employee-row">
                  <label className="party-size-field">
                    <span className="field-label">{t('editor.partySize')}</span>
                    <div className="party-size-control">
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={form.partySize}
                        onChange={(e) => setForm({ ...form, partySize: e.target.value })}
                        onBlur={() => setForm((current) => {
                          const parsed = parseInt(current.partySize, 10);
                          const clamped = Number.isFinite(parsed) ? Math.min(99, Math.max(1, parsed)) : 1;
                          // Trim excess assigned employees to fit the reduced party size.
                          const employeeIds = current.employeeIds.slice(0, clamped);
                          return { ...current, partySize: String(clamped), employeeIds };
                        })}
                      />
                    </div>
                  </label>
                  <div className="employee-field appointment-field">
                    <span className="field-label">
                      <label htmlFor="appointment-employees">{t('editor.employee')}</label>
                      <FieldHelp id="employee-help" label={t('editor.employeeHelp')}
                        text={pendingAutoCount > 0
                          ? t('editor.pendingAutoHint', { count: String(pendingAutoCount) })
                          : t('editor.pendingNone')} />
                    </span>
                    <div className="employee-dropdown">
                      <button
                        type="button"
                        id="appointment-employees"
                        className="employee-dropdown-toggle"
                        aria-expanded={employeeDropdownOpen}
                        aria-haspopup="listbox"
                        onClick={() => setEmployeeDropdownOpen((open) => !open)}
                      >
                        {selectedEmployeeNamesLabel || t('editor.selectEmployee')}
                      </button>
                      {employeeDropdownOpen ? (
                        <div className="employee-dropdown-panel" role="group" aria-label={t('editor.employee')}>
                          {assignableEmployeeOptions.map((user) => {
                            const checked = form.employeeIds.includes(user.id);
                            return (
                              <label key={user.id} className="checkbox-option">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    if (!e.target.checked) {
                                      setForm((current) => ({
                                        ...current,
                                        employeeIds: current.employeeIds.filter((id) => id !== user.id),
                                      }));
                                      return;
                                    }
                                    if (partySizeValue === 1) {
                                      // Single-slot party: newly checked employee replaces any prior selection.
                                      setForm((current) => ({ ...current, employeeIds: [user.id] }));
                                      return;
                                    }
                                    if (form.employeeIds.length >= partySizeValue) {
                                      showOperationError(t('notices.employeeCapReached'));
                                      return;
                                    }
                                    setForm((current) => ({
                                      ...current,
                                      employeeIds: [...current.employeeIds, user.id],
                                    }));
                                  }}
                                />
                                {user.displayName}{isManagerRole(user.role) ? ` • ${t('role.MANAGER')}` : ''}
                              </label>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="row">
                  <div className="appointment-field">
                    <span className="field-label">
                      <label htmlFor="appointment-start-date">{t('editor.startDate')} <span className="required-indicator" aria-hidden="true">*</span></label>
                      <FieldHelp id="start-date-help" text={t('editor.dateHint')} label={t('editor.startDateHelp')} />
                      <span className="field-label-note" aria-live="polite">
                        {startDateWeekdayLabel ? startDateWeekdayLabel : t('editor.invalidDate')}
                      </span>
                    </span>
                    <input
                      id="appointment-start-date"
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
                      <button type="button" onClick={applyToday}>{t('shortcut.today')}</button>
                      <NativeDateChooser value={form.startDate}
                        onChange={(startDate) => setForm((current) => ({ ...current, startDate }))}
                        onError={(error) => showOperationError(t('editor.datePickerFailed', {
                          error: error instanceof Error ? error.message : String(error),
                        }))} />
                    </div>
                  </div>
                  <div className="start-time-field">
                    <span className="field-label">
                      <label htmlFor="appointment-start-time">
                        {t('editor.startTime')} <span className="required-indicator" aria-hidden="true">*</span>
                      </label>
                      <FieldHelp id="start-time-help" text={t('editor.startTimeHint')} label={t('editor.startTimeHelp')} />
                    </span>
                    <input
                      id="appointment-start-time"
                      type="text"
                      inputMode="numeric"
                      autoCapitalize="off"
                      autoCorrect="off"
                      aria-label={t('editor.startTime')}
                      placeholder={t('editor.startTimePlaceholder')}
                      aria-invalid={startTimeError ? true : undefined}
                      aria-describedby={`start-time-help${startTimeError ? ' start-time-error' : ''}`}
                      value={form.startTime}
                      onFocus={() => {
                        setForm((current) => /^\d{1,2}:\d{2}$/.test(current.startTime)
                          ? { ...current, startTime: current.startTime.replace(':', '') }
                          : current);
                      }}
                      onKeyDown={(event) => {
                        if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
                        if (event.key.length === 1 && !/^\d$/.test(event.key)) {
                          event.preventDefault();
                          rejectStartTimeInput();
                        } else if (/^\d$/.test(event.key)) {
                          const input = event.currentTarget;
                          if (input.value.length - ((input.selectionEnd ?? 0) - (input.selectionStart ?? 0)) >= 4) {
                            event.preventDefault();
                            rejectStartTimeInput();
                          }
                        }
                      }}
                      onPaste={(event) => {
                        const input = event.currentTarget;
                        const pasted = event.clipboardData.getData('text');
                        const next = input.value.slice(0, input.selectionStart ?? 0)
                          + pasted + input.value.slice(input.selectionEnd ?? input.value.length);
                        if (!/^\d*$/.test(pasted) || next.length > 4) {
                          event.preventDefault();
                          rejectStartTimeInput();
                        }
                      }}
                      onChange={(e) => {
                        if (!/^\d{0,4}$/.test(e.target.value)) {
                          rejectStartTimeInput();
                          return;
                        }
                        clearStartTimeError();
                        appointmentStartTimeEditedRef.current = true;
                        setForm((current) => ({ ...current, startTime: e.target.value }));
                      }}
                      onBlur={(event) => {
                        if (rejectedStartTimeInputRef.current) return;
                        if (editingId && !appointmentStartTimeEditedRef.current && originalEditingStartAtRef.current) {
                          const normalized = formatAppointmentTimeInput(originalEditingStartAtRef.current);
                          setForm((current) => ({ ...current, startTime: normalized }));
                          return;
                        }
                        const resolution = resolveStartTimeInput(event.currentTarget.value);
                        if (resolution.status === 'valid') {
                          clearStartTimeError();
                          setForm((current) => ({
                            ...current,
                            startTime: resolution.parsed.normalized,
                          }));
                        } else {
                          setStartTimeError(startTimeErrorKey(resolution.status));
                        }
                      }}
                    />
                    {startTimeError && <span id="start-time-error" className="hint error" role="status">
                      {t(startTimeError, {
                        start: calendarWindow.slotMinTime.slice(0, 5),
                        end: calendarWindow.slotMaxTime.slice(0, 5),
                      })}
                    </span>}
                  </div>
                </div>
                <div className="row">
                  <div className="appointment-field">
                    <span className="field-label">
                      <label htmlFor="appointment-duration">{t('editor.duration')} <span className="required-indicator" aria-hidden="true">*</span></label>
                      <FieldHelp id="duration-help" text={t('editor.previewPlaceholder')} label={t('editor.durationHelp')} />
                    </span>
                    <input
                      id="appointment-duration"
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
                    {durationPreview.text && <span className={`hint ${durationPreview.crossesDay ? 'duration-preview-error' : ''}`}>
                      {durationPreview.text}
                    </span>}
                  </div>
                </div>
                <div className="row">
                  <label>
                    <span className="field-label">
                      {t('editor.phone')} <span className="required-indicator" aria-hidden="true">*</span>
                    </span>
                    <input
                      ref={attachPhoneInput}
                      type="text"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="(___)___-____"
                      value={displayPhoneValue}
                      onPaste={handlePhonePaste}
                      onChange={(event) => {
                        const nativeEvent = event.nativeEvent as InputEvent;
                        reconcilePhoneInputChange(
                          event.currentTarget,
                          nativeEvent.inputType,
                          nativeEvent.isComposing,
                        );
                      }}
                      onCompositionEnd={(event) => reconcilePhoneInputChange(event.currentTarget)}
                    />
                    {currentPhoneLookupError ? (
                      <span className="message error phone-lookup-notice" role="status" aria-live="polite">
                        {currentPhoneLookupError.message}
                        <button type="button" onClick={() => setPhoneLookupRetry((current) => current + 1)}>
                          {t('actions.retry')}
                        </button>
                      </span>
                    ) : null}
                  </label>
                  <label>
                    <span className="field-label">
                      {t('editor.price')}
                    </span>
                    <input type="text" inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
                  </label>
                </div>
                <label>
                  {t('editor.customerName')}
                  <input
                    value={form.customerName}
                    onChange={(e) => {
                      phoneNameEditedRef.current = true;
                      setForm((current) => ({ ...current, customerName: e.target.value }));
                    }}
                  />
                </label>
                <label>
                  {t('editor.note')}
                  <textarea
                    value={form.note}
                    onChange={(e) => {
                      phoneNoteEditedRef.current = true;
                      setForm((current) => ({ ...current, note: e.target.value }));
                    }}
                  />
                </label>
                <div className="row">
                  <button type="submit" disabled={loading || isSelectedAppointmentCancelled}>{editingId ? t('actions.updateAppointment') : t('actions.createAppointment')}</button>
                  {editingId ? <button type="button" onClick={() => {
                    setEditingId(null);
                    setForm(createInitialForm());
                    originalEditingStartAtRef.current = null;
                    appointmentStartTimeEditedRef.current = false;
                    clearStartTimeError();
                    phoneNameEditedRef.current = false;
                    phoneNoteEditedRef.current = false;
                  }}>{t('actions.cancel')}</button> : null}
                  {editingId ? <button type="button" disabled={loading || isSelectedAppointmentCancelled} onClick={() => void handleCancelAppointment(editingId)}>{t('actions.cancelAppointment')}</button> : null}
                  {editingId && (isAdmin || isManager) ? <button type="button" className="danger-action" disabled={loading} onClick={() => void handleDelete(editingId)}>{t('actions.deleteAppointment')}</button> : null}
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
                <div className="legend" role="group" aria-label={t('editor.employee')}>
                  <button
                    type="button"
                    className={`legend-item legend-filter-button${employeeFilter === 'all' ? ' active' : ''}`}
                    aria-pressed={employeeFilter === 'all'}
                    onClick={() => setEmployeeFilter('all')}
                  >
                    {t('calendar.allEmployees')}
                  </button>
                  {employeeOptions.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className={`legend-item legend-filter-button${employeeFilter === user.id ? ' active' : ''}`}
                      aria-pressed={employeeFilter === user.id}
                      onClick={() => setEmployeeFilter(user.id)}
                    >
                      <span className="legend-swatch" style={{ backgroundColor: getEmployeeColor(user.id) }} />
                      <span>
                        {isPendingAssignmentEmployee(user, pendingAssignmentRuntime)
                          ? t('editor.pendingAssignment')
                          : `${user.displayName}${isManagerRole(user.role) ? ` • ${t('role.MANAGER')}` : ''}`}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="date-strip" aria-label={t('calendar.dateNavAria')}>
                  <div className="date-strip-actions">
                    <button type="button" onClick={() => handleMobileCalendarNavigate('prev')}>{t('calendar.prev')}</button>
                    <button type="button" onClick={() => handleMobileCalendarNavigate('today')}>{t('shortcut.today')}</button>
                    <button type="button" onClick={() => handleMobileCalendarNavigate('next')}>{t('calendar.next')}</button>
                  </div>
                  <NativeDateChooser value={formatDateForUsInput(selectedDate)}
                    triggerContent={selectedDateLabel} accessibleLabel={selectedDateLabel}
                    className="calendar-date-chooser" triggerClassName="date-strip-label"
                    onChange={handleCalendarDateChoose}
                    onError={(error) => showOperationError(t('editor.datePickerFailed', {
                      error: error instanceof Error ? error.message : String(error),
                    }))} />
                </div>
              </div>
              <CalendarFrame ready={calendarWindowReady} layoutKey={calendarView}
                slotMinTime={displayCalendarWindow.slotMinTime} slotMaxTime={displayCalendarWindow.slotMaxTime}
                consumed={initialCalendarScrollConsumed}>
                <FullCalendar
                  ref={calendarRef}
                  key={calendarView}
                  plugins={[timeGridPlugin, interactionPlugin]}
                  initialView={calendarView}
                  initialDate={selectedDate}
                  headerToolbar={false}
                  slotEventOverlap={false}
                  views={{
                    timeGridWeek: {
                      eventMinHeight: 22,
                    },
                    timeGridThreeDay: {
                      type: 'timeGrid',
                      duration: { days: 3 },
                      dateAlignment: 'day',
                      dateIncrement: { days: 3 },
                    },
                  }}
                  dayHeaderContent={(arg) => (
                    <div className="calendar-day-header" aria-label={arg.text}>
                      <span className="calendar-day-header-weekday">{calendarDayHeaderWeekdayFormatter.format(arg.date)}</span>
                      <span className="calendar-day-header-date">{calendarDayHeaderDateFormatter.format(arg.date)}</span>
                    </div>
                  )}
                  allDaySlot={false}
                  nowIndicator={true}
                  slotMinTime={displayCalendarWindow.slotMinTime}
                  slotMaxTime={displayCalendarWindow.slotMaxTime}
                  slotDuration="00:30:00"
                  snapDuration="00:30:00"
                  slotLabelInterval="01:00:00"
                  slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
                  eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: true, meridiem: 'short' }}
                  editable={true}
                  selectable={true}
                  selectAllow={(selection) => allowCalendarStart(selection.start)}
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
              </CalendarFrame>
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
                    {todayAgendaAppointments.map((appointment) => {
                      const isCancelled = isCancelledAppointment(appointment);
                      return (
                        <button
                          key={appointment.id}
                          type="button"
                          className={`agenda-item${isCancelled ? ' agenda-item-cancelled' : ''}`}
                          style={{ '--agenda-accent': isCancelled ? CANCELLED_APPOINTMENT_ACCENT : getAppointmentColor(appointment) } as CSSProperties}
                          onClick={() => handleEdit(appointment)}
                        >
                          <div className="agenda-time">{formatAgendaTimeRange(appointment.startAt, appointment.endAt, locale)}</div>
                          <div className="agenda-meta">
                            <span>{getAppointmentDisplayName(appointment)}</span>
                            <span>{t('agenda.phone', { value: appointment.phone })}</span>
                            {isCancelled ? <span className="agenda-status-badge">{t('status.cancelled')}</span> : null}
                          </div>
                        </button>
                      );
                    })}
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
                          {group.appointments.map((appointment) => {
                            const isCancelled = isCancelledAppointment(appointment);
                            return (
                              <button
                                key={appointment.id}
                                type="button"
                                className={`agenda-item${isCancelled ? ' agenda-item-cancelled' : ''}`}
                                style={{ '--agenda-accent': isCancelled ? CANCELLED_APPOINTMENT_ACCENT : getAppointmentColor(appointment) } as CSSProperties}
                                onClick={() => handleEdit(appointment)}
                              >
                                <div className="agenda-time">{formatAgendaTimeRange(appointment.startAt, appointment.endAt, locale)}</div>
                                <div className="agenda-meta">
                                  <span>{t('agenda.phone', { value: appointment.phone })}</span>
                                  {isCancelled ? <span className="agenda-status-badge">{t('status.cancelled')}</span> : null}
                                </div>
                              </button>
                            );
                          })}
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
                <strong>{todaySummary.nextAppointment ? `${formatTimeOnly(todaySummary.nextAppointment.startAt, locale)} • ${getAppointmentDisplayName(todaySummary.nextAppointment)}` : t('overview.none')}</strong>
              </div>
            </div>
          </div>
          <h3 className="section-title">{t('overview.todayAppointments')}</h3>
          <div className="appointment-list">
            {appointments.map((appointment) => {
              const displayName = getAppointmentDisplayName(appointment);
              const accentColor = getAppointmentColor(appointment);
              const isCancelled = isCancelledAppointment(appointment);
              return (
                <div key={appointment.id} className={`appointment-item${isCancelled ? ' appointment-item-cancelled' : ''}`} style={{ borderLeftColor: isCancelled ? CANCELLED_APPOINTMENT_ACCENT : accentColor }}>
                  <div className="appointment-main">
                    <div className="appointment-heading">
                      <span className="employee-marker" style={{ backgroundColor: isCancelled ? CANCELLED_APPOINTMENT_ACCENT : accentColor }} />
                      <div>
                        <strong>{displayName}</strong>
                        <div className="appointment-time">{formatAppointmentWindow(appointment.startAt, appointment.endAt, locale)}</div>
                      </div>
                    </div>
                    <div className="appointment-details">
                      <span className="appointment-badge">{t('overview.badgePhone', { value: appointment.phone })}</span>
                      <span className="appointment-badge appointment-price">{t('overview.badgePrice', { value: appointment.price })}</span>
                      {isCancelled ? <span className="appointment-badge appointment-status-cancelled">{t('status.cancelled')}</span> : null}
                    </div>
                  </div>
                  <div className="appointment-actions">
                    <button type="button" onClick={() => handleEdit(appointment)}>{t('actions.edit')}</button>
                    <button type="button" disabled={isCancelled} onClick={() => void handleCancelAppointment(appointment.id)}>{t('actions.cancelShort')}</button>
                    {isAdmin || isManager ? <button type="button" onClick={() => void handleDelete(appointment.id)}>{t('actions.delete')}</button> : null}
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
            <form onInvalidCapture={event => {
                event.preventDefault();
                showOperationError((event.target as HTMLInputElement).validationMessage);
              }} onSubmit={handleCalendarWindowSave} className="stack">
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

          <form onInvalidCapture={event => {
                event.preventDefault();
                showOperationError((event.target as HTMLInputElement).validationMessage);
              }} onSubmit={handleAdminCreateUser} className="stack">
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
            <label>
              {t('admin.role')}
              <select
                name="role"
                value={adminCreateUserForm.role}
                onChange={(event) => setAdminCreateUserForm((current) => ({ ...current, role: event.target.value as UserRoleValue }))}
              >
                {EMPLOYEE_MANAGED_ROLES.map((role) => (
                  <option key={role} value={role}>{t(`role.${role}`)}</option>
                ))}
              </select>
            </label>
            <button type="submit">{t('admin.createUser')}</button>
          </form>

          <div className="admin-block">
            <h3>{t('admin.passwordResetTitle')}</h3>
            <p className="hint">{t('admin.passwordResetHint')}</p>
            <form onInvalidCapture={event => {
                event.preventDefault();
                showOperationError((event.target as HTMLInputElement).validationMessage);
              }} onSubmit={handleAdminResetPassword} className="stack">
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
                  <div>{user.username} • {ROLE_MESSAGES[user.role] ? t(ROLE_MESSAGES[user.role]) : user.role}</div>
                </div>
                <div className="user-actions">
                  <button
                    type="button"
                    onClick={() => handleToggleUserStatus(user.id, isActiveStatus(user.status) ? 'INACTIVE' : 'ACTIVE')}
                  >
                    {isActiveStatus(user.status) ? t('admin.disable') : t('admin.enable')}
                  </button>
                  {!isAdminRole(user.role) ? (
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
                (() => {
                  const actorSnapshot = isUnknownRecord(log.actorSnapshot)
                    ? log.actorSnapshot
                    : null;
                  const shopSnapshot = isUnknownRecord(log.shopSnapshot)
                    ? log.shopSnapshot
                    : null;
                  const actorName = typeof actorSnapshot?.displayName === 'string'
                    ? actorSnapshot.displayName
                    : log.actor.displayName;
                  const actorUsername = typeof actorSnapshot?.username === 'string'
                    ? actorSnapshot.username
                    : log.actor.username;
                  const actorRole = typeof actorSnapshot?.role === 'string'
                    ? actorSnapshot.role
                    : log.actor.role;
                  const shopName = typeof shopSnapshot?.name === 'string'
                    ? shopSnapshot.name
                    : log.shop?.name ?? currentShopName;
                  const presentation = getAuditPresentation(
                    log.beforePayload,
                    log.afterPayload,
                    log.entityType,
                    locale,
                    (value) => new Date(value).toLocaleString(locale, {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true,
                    }),
                    t('logs.noChangeDetails'),
                    t('logs.noChanges'),
                    t('logs.unrecognizedPayload'),
                  );
                  const actionMessage = AUDIT_ACTION_MESSAGES[log.action];
                  const rawDetails = JSON.stringify({
                    actor: log.actorSnapshot,
                    shop: log.shopSnapshot,
                    before: log.beforePayload,
                    after: log.afterPayload,
                  }, null, 2);

                  return (
                    <article key={log.id} className="logs-item" role="listitem">
                      <div className="logs-row">
                        <strong>{actionMessage ? t(actionMessage) : log.action}</strong>
                        <span className="appointment-badge">{log.entityType}</span>
                        <span className="hint">{new Date(log.createdAt).toLocaleString(locale, {
                          year: 'numeric', month: '2-digit', day: '2-digit',
                          hour: 'numeric', minute: '2-digit', hour12: true,
                        })}</span>
                      </div>
                      <div className="logs-meta">
                        <span>{t('logs.actor', { displayName: actorName, username: actorUsername })}</span>
                        <span>{t('logs.role', {
                          role: ROLE_MESSAGES[actorRole] ? t(ROLE_MESSAGES[actorRole]) : actorRole,
                        })}</span>
                        <span>{t('logs.shop', { shopName })}</span>
                      </div>
                      {presentation.legacyMissing || presentation.unrecognizedPayload ? (
                        <p className="hint">{presentation.summary[0]}</p>
                      ) : (
                        <div className="logs-diff">
                          {presentation.changes.map((change) => (
                            <div key={change.field}>
                              <span className="summary-label">{change.field}</span>{' '}
                              {change.before ? `${change.before} → ` : ''}
                              {change.after}
                            </div>
                          ))}
                          {presentation.changes.length === 0
                            ? <div>{t('logs.noChanges')}</div>
                            : null}
                        </div>
                      )}
                      <details className="audit-raw-details">
                        <summary>{t('logs.rawDetails')}</summary>
                        <pre>{rawDetails ?? '{}'}</pre>
                      </details>
                      <span className="hint">{t('logs.target', { entityType: log.entityType, entityId: log.entityId })}</span>
                    </article>
                  );
                })()
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

export default App;
