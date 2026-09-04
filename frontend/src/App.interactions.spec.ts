// @vitest-environment jsdom
import React, { act, useEffect, useImperativeHandle, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { I18nProvider } from './i18n/i18n';

vi.mock('@fullcalendar/react', () => {
  const MockFullCalendar = React.forwardRef<any, any>((props, ref) => {
    const calendarRootRef = useRef<HTMLDivElement | null>(null);

    useImperativeHandle(ref, () => ({
      getApi: () => ({
        getDate: () => new Date(2026, 6, 30, 10, 0, 0, 0),
        prev: vi.fn(),
        next: vi.fn(),
        gotoDate: vi.fn(),
      }),
    }));

    useEffect(() => {
      if (!calendarRootRef.current) {
        return undefined;
      }

      const noteText = (globalThis as any).__TEST_CALENDAR_NOTE_TEXT ?? 'Color service note';
      const isTruncated = Boolean((globalThis as any).__TEST_CALENDAR_NOTE_TRUNCATED);

      const eventHost = document.createElement('div');
      const noteElement = document.createElement('div');
      noteElement.className = 'calendar-event-note';
      noteElement.textContent = noteText;

      Object.defineProperties(noteElement, {
        clientWidth: { configurable: true, get: () => (isTruncated ? 64 : 120) },
        scrollWidth: { configurable: true, get: () => (isTruncated ? 140 : 120) },
        clientHeight: { configurable: true, get: () => (isTruncated ? 20 : 40) },
        scrollHeight: { configurable: true, get: () => (isTruncated ? 44 : 40) },
      });

      eventHost.appendChild(noteElement);
      calendarRootRef.current.appendChild(eventHost);
      props.eventDidMount?.({ el: eventHost });

      return () => {
        props.eventWillUnmount?.({ el: eventHost });
        eventHost.remove();
      };
    }, [props.eventDidMount, props.eventWillUnmount]);

    return React.createElement(
      'div',
      { 'data-testid': 'mock-calendar', ref: calendarRootRef },
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => props.dateClick?.({ date: new Date(2026, 6, 30, 14, 30, 0, 0) }),
        },
        'Mock date click',
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => props.eventClick?.({ event: { id: 'appt-1' } }),
        },
        'Mock event click',
      ),
    );
  });

  return { default: MockFullCalendar };
});

class MockEventSource {
  addEventListener() {
    return undefined;
  }

  removeEventListener() {
    return undefined;
  }

  close() {
    return undefined;
  }
}

type TestRole = 'ADMIN' | 'EMPLOYEE';

const setMockCalendarNoteState = (isTruncated: boolean, noteText = 'Color service note') => {
  (globalThis as any).__TEST_CALENDAR_NOTE_TRUNCATED = isTruncated;
  (globalThis as any).__TEST_CALENDAR_NOTE_TEXT = noteText;
};

const setMobilePointerMode = (isMobilePointer: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: isMobilePointer,
      media: '(hover: none), (pointer: coarse)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const waitFor = async (predicate: () => boolean, timeoutMs = 2000) => {
  const started = Date.now();

  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
};

const findButtonByLabel = (container: HTMLElement, label: string) => {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === label) ?? null;
};

const clickButton = async (container: HTMLElement, label: string) => {
  const button = findButtonByLabel(container, label);
  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }

  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const clickElement = async (element: HTMLElement) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const findControlInLabel = (
  container: HTMLElement,
  labelText: string,
  selector: 'input' | 'textarea' | 'select' = 'input',
) => {
  const labels = Array.from(container.querySelectorAll('label'));
  const match = labels.find((label) => label.textContent?.includes(labelText));
  if (!match) {
    return null;
  }

  return match.querySelector(selector);
};

const setControlValue = async (
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) => {
  await act(async () => {
    const prototype = Object.getPrototypeOf(control);
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (valueSetter) {
      valueSetter.call(control, value);
    } else {
      control.value = value;
    }
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const makeFetchMock = (role: TestRole) => {
  const auth = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    tokenType: 'Bearer',
    user: {
      id: role === 'ADMIN' ? 'admin-1' : 'emp-logged-in',
      username: role === 'ADMIN' ? 'admin' : 'employee',
      displayName: role === 'ADMIN' ? 'Admin User' : 'Employee User',
      role,
      status: 'ACTIVE',
    },
  };

  const users = [
    {
      id: 'emp-1',
      username: 'anna',
      displayName: 'Anna',
      role: 'EMPLOYEE',
      status: 'ACTIVE',
    },
    {
      id: auth.user.id,
      username: auth.user.username,
      displayName: auth.user.displayName,
      role,
      status: 'ACTIVE',
    },
  ];

  const appointments = [
    {
      id: 'appt-1',
      employeeId: 'emp-1',
      startAt: '2026-07-30T14:00:00.000Z',
      endAt: '2026-07-30T15:00:00.000Z',
      phone: '1234567890',
      price: '80.00',
      customerName: 'Chris',
      note: 'Color service',
    },
  ];

  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.endsWith('/auth/login') && method === 'POST') {
      return ok(auth);
    }

    if (url.includes('/users') && method === 'GET') {
      return ok(users);
    }

    if (url.includes('/appointments') && method === 'GET') {
      return ok(appointments);
    }

    if (url.includes('/system-settings/calendar-window') && method === 'GET') {
      return ok({ slotMinTime: '08:00:00', slotMaxTime: '20:00:00' });
    }

    if (url.includes('/appointments/appt-1') && method === 'DELETE') {
      return ok({ success: true });
    }

    return ok({});
  });
};

const renderAndLogin = async (role: TestRole, viewportWidth: number) => {
  setViewportWidth(viewportWidth);
  (globalThis as any).EventSource = MockEventSource;
  const fetchMock = makeFetchMock(role);
  vi.stubGlobal('fetch', fetchMock);

  const container = document.createElement('div');
  document.body.appendChild(container);

  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(I18nProvider, null, React.createElement(App)));
  });

  const loginForm = container.querySelector('form');
  if (!loginForm) {
    throw new Error('Login form not found');
  }

  const loginInputs = Array.from(loginForm.querySelectorAll('input')) as HTMLInputElement[];
  const usernameInput = loginInputs[0] ?? null;
  const passwordInput = loginInputs[1] ?? null;
  if (!usernameInput || !passwordInput) {
    throw new Error('Login inputs not found');
  }

  await setControlValue(usernameInput, role === 'ADMIN' ? 'admin' : 'employee');
  await setControlValue(passwordInput, 'admin123');

  await act(async () => {
    loginForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  await waitFor(() => container.textContent?.includes('Signed in as') ?? false);
  await flush();

  return { container, root, fetchMock };
};

const cleanupRender = async (root: Root, container: HTMLElement) => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
};

describe('App interaction seams', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '';
    setMockCalendarNoteState(false);
    setMobilePointerMode(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the mobile primary calendar control label when using mobile width', async () => {
    const { container, root } = await renderAndLogin('ADMIN', 800);

    const primaryControl = findButtonByLabel(container, '3-day');
    expect(primaryControl).not.toBeNull();
    expect(primaryControl?.className).toContain('active');

    await cleanupRender(root, container);
  });

  it('defaults to 3-day as the primary active view on desktop width', async () => {
    const { container, root } = await renderAndLogin('ADMIN', 1280);

    const threeDayControl = findButtonByLabel(container, '3-day');
    expect(threeDayControl).not.toBeNull();
    expect(threeDayControl?.className).toContain('active');

    await cleanupRender(root, container);
  });

  it('applies slot click autofill and exits editing mode back to create intent', async () => {
    const { container, root } = await renderAndLogin('ADMIN', 1280);

    await clickButton(container, 'Mock event click');
    await waitFor(() => container.textContent?.includes('Update appointment') ?? false);

    await clickButton(container, 'Mock date click');
    await waitFor(() => container.textContent?.includes('Create appointment') ?? false);

    const startDateInput = container.querySelector('input[aria-label="Start date in MM/DD/YYYY format"]') as HTMLInputElement | null;
    const startTimeInput = findControlInLabel(container, 'Start time', 'input') as HTMLInputElement | null;

    expect(startDateInput?.value).toBe('07/30/2026');
    expect(startTimeInput?.value).toBe('14:30');

    await cleanupRender(root, container);
  });

  it('shows admin delete styling while editing an appointment', async () => {
    const { container, root } = await renderAndLogin('ADMIN', 1280);

    await clickButton(container, 'Mock event click');
    await waitFor(() => container.textContent?.includes('Update appointment') ?? false);

    const deleteButton = findButtonByLabel(container, 'Delete appointment');
    expect(deleteButton).not.toBeNull();
    expect(deleteButton?.className).toContain('danger-action');

    await cleanupRender(root, container);
  });

  it('renders selected appointment window in 24-hour format', async () => {
    const { container, root } = await renderAndLogin('ADMIN', 1280);

    await clickButton(container, 'Mock event click');
    await waitFor(() => container.textContent?.includes('Update appointment') ?? false);

    expect(container.textContent).toMatch(/\b\d{2}:\d{2} - \d{2}:\d{2}\b/);
    expect(container.textContent).not.toContain('PM');
    expect(container.textContent).not.toContain('AM');

    await cleanupRender(root, container);
  });

  it('shows employee cancel behavior while editing without admin danger class', async () => {
    const { container, root } = await renderAndLogin('EMPLOYEE', 1280);

    await clickButton(container, 'Mock event click');
    await waitFor(() => container.textContent?.includes('Update appointment') ?? false);

    const cancelButton = findButtonByLabel(container, 'Cancel appointment');
    expect(cancelButton).not.toBeNull();
    expect(cancelButton?.className).not.toContain('danger-action');

    await cleanupRender(root, container);
  });

  it('autofills start date and time when switching mobile 3-day to Day before slot click', async () => {
    const { container, root } = await renderAndLogin('ADMIN', 800);

    const threeDayButton = findButtonByLabel(container, '3-day');
    expect(threeDayButton).not.toBeNull();
    expect(threeDayButton?.className).toContain('active');

    await clickButton(container, 'Day');
    const dayButton = findButtonByLabel(container, 'Day');
    expect(dayButton?.className).toContain('active');

    await clickButton(container, 'Mock date click');

    const startDateInput = container.querySelector('input[aria-label="Start date in MM/DD/YYYY format"]') as HTMLInputElement | null;
    const startTimeInput = findControlInLabel(container, 'Start time', 'input') as HTMLInputElement | null;

    await waitFor(() => (startTimeInput?.value ?? '') === '14:30');
    expect(startDateInput?.value).toBe('07/30/2026');
    expect(startTimeInput?.value).toBe('14:30');

    await cleanupRender(root, container);
  });

  it('keeps mobile 3-day primary control available and active after Prev and Next navigation', async () => {
    const { container, root } = await renderAndLogin('ADMIN', 800);

    const initialPrimaryControl = findButtonByLabel(container, '3-day');
    expect(initialPrimaryControl).not.toBeNull();
    expect(initialPrimaryControl?.className).toContain('active');

    await clickButton(container, 'Prev');
    const afterPrevPrimaryControl = findButtonByLabel(container, '3-day');
    expect(afterPrevPrimaryControl).not.toBeNull();
    expect(afterPrevPrimaryControl?.className).toContain('active');

    await clickButton(container, 'Next');
    const afterNextPrimaryControl = findButtonByLabel(container, '3-day');
    expect(afterNextPrimaryControl).not.toBeNull();
    expect(afterNextPrimaryControl?.className).toContain('active');

    await cleanupRender(root, container);
  });

  it('shows mobile fixed note layer for truncated note content', async () => {
    const longNote = 'Long mobile note details to verify fixed layer rendering and full content visibility.';
    setMockCalendarNoteState(true, longNote);
    setMobilePointerMode(true);
    const { container, root } = await renderAndLogin('ADMIN', 800);

    const noteElement = container.querySelector('.calendar-event-note') as HTMLElement | null;
    expect(noteElement).not.toBeNull();

    await clickElement(noteElement as HTMLElement);

    await waitFor(() => document.querySelector('.calendar-note-tooltip-layer') !== null);
    const tooltipContent = document.querySelector('.calendar-note-tooltip-content');
    expect(tooltipContent?.textContent).toContain(longNote);

    await cleanupRender(root, container);
  });

  it('closes mobile fixed note layer when clicking blank backdrop area', async () => {
    setMockCalendarNoteState(true, 'Backdrop close test note');
    setMobilePointerMode(true);
    const { container, root } = await renderAndLogin('ADMIN', 800);

    const noteElement = container.querySelector('.calendar-event-note') as HTMLElement | null;
    expect(noteElement).not.toBeNull();
    await clickElement(noteElement as HTMLElement);
    await waitFor(() => document.querySelector('.calendar-note-tooltip-layer') !== null);

    const backdrop = document.querySelector('.calendar-note-tooltip-backdrop') as HTMLElement | null;
    expect(backdrop).not.toBeNull();
    await clickElement(backdrop as HTMLElement);
    await waitFor(() => document.querySelector('.calendar-note-tooltip-layer') === null);

    await cleanupRender(root, container);
  });

  it('closes mobile fixed note layer when clicking close button', async () => {
    setMockCalendarNoteState(true, 'Button close test note');
    setMobilePointerMode(true);
    const { container, root } = await renderAndLogin('ADMIN', 800);

    const noteElement = container.querySelector('.calendar-event-note') as HTMLElement | null;
    expect(noteElement).not.toBeNull();
    await clickElement(noteElement as HTMLElement);
    await waitFor(() => document.querySelector('.calendar-note-tooltip-layer') !== null);

    const closeButton = document.querySelector('.calendar-note-tooltip-close') as HTMLElement | null;
    expect(closeButton).not.toBeNull();
    await clickElement(closeButton as HTMLElement);
    await waitFor(() => document.querySelector('.calendar-note-tooltip-layer') === null);

    await cleanupRender(root, container);
  });

  it('does not show mobile fixed note layer when note is not truncated', async () => {
    setMockCalendarNoteState(false, 'Short note');
    setMobilePointerMode(true);
    const { container, root } = await renderAndLogin('ADMIN', 800);

    const noteElement = container.querySelector('.calendar-event-note') as HTMLElement | null;
    expect(noteElement).not.toBeNull();
    await clickElement(noteElement as HTMLElement);

    await flush();
    expect(document.querySelector('.calendar-note-tooltip-layer')).toBeNull();

    await cleanupRender(root, container);
  });

  it('preserves non-time fields when clicking a slot while already in create mode', async () => {
    const { container, root } = await renderAndLogin('ADMIN', 1280);

    const durationInput = findControlInLabel(container, 'Duration (minutes)', 'input') as HTMLInputElement | null;
    const phoneInput = findControlInLabel(container, 'Phone', 'input') as HTMLInputElement | null;
    const priceInput = findControlInLabel(container, 'Price', 'input') as HTMLInputElement | null;
    const customerInput = findControlInLabel(container, 'Customer name', 'input') as HTMLInputElement | null;
    const noteInput = findControlInLabel(container, 'Note', 'textarea') as HTMLTextAreaElement | null;

    expect(durationInput).not.toBeNull();
    expect(phoneInput).not.toBeNull();
    expect(priceInput).not.toBeNull();
    expect(customerInput).not.toBeNull();
    expect(noteInput).not.toBeNull();

    await clickButton(container, '90');
    await waitFor(() => (durationInput as HTMLInputElement).value === '90');
    await setControlValue(phoneInput as HTMLInputElement, '5551234567');
    await setControlValue(priceInput as HTMLInputElement, '125.5');
    await setControlValue(customerInput as HTMLInputElement, 'Taylor');
    await setControlValue(noteInput as HTMLTextAreaElement, 'Please call on arrival');

    await clickButton(container, 'Mock date click');

    const startDateInput = container.querySelector('input[aria-label="Start date in MM/DD/YYYY format"]') as HTMLInputElement | null;
    const startTimeInput = findControlInLabel(container, 'Start time', 'input') as HTMLInputElement | null;

    await waitFor(() => (startTimeInput?.value ?? '') === '14:30');

    expect(startDateInput?.value).toBe('07/30/2026');
    expect(startTimeInput?.value).toBe('14:30');
    expect((durationInput as HTMLInputElement).value).toBe('90');
    expect((phoneInput as HTMLInputElement).value).toBe('(555)123-4567');
    expect((priceInput as HTMLInputElement).value).toBe('125.5');
    expect((customerInput as HTMLInputElement).value).toBe('Taylor');
    expect((noteInput as HTMLTextAreaElement).value).toBe('Please call on arrival');
    expect(container.textContent?.includes('Create appointment')).toBe(true);

    await cleanupRender(root, container);
  });

  it('keeps display name read-only and synced to username in admin create user form', async () => {
    const { container, root, fetchMock } = await renderAndLogin('ADMIN', 1280);

    await clickButton(container, 'Admin');

    const usernameInput = findControlInLabel(container, 'Username', 'input') as HTMLInputElement | null;
    const displayNameInput = findControlInLabel(container, 'Display name', 'input') as HTMLInputElement | null;
    const passwordInput = findControlInLabel(container, 'Password', 'input') as HTMLInputElement | null;
    const confirmPasswordInput = findControlInLabel(container, 'Confirm password', 'input') as HTMLInputElement | null;

    expect(usernameInput).not.toBeNull();
    expect(displayNameInput).not.toBeNull();
    expect(passwordInput).not.toBeNull();
    expect(confirmPasswordInput).not.toBeNull();

    await setControlValue(usernameInput as HTMLInputElement, 'new.employee');
    expect((displayNameInput as HTMLInputElement).readOnly).toBe(true);
    expect((displayNameInput as HTMLInputElement).value).toBe('new.employee');

    await setControlValue(passwordInput as HTMLInputElement, 'secret123');
    await setControlValue(confirmPasswordInput as HTMLInputElement, 'secret123');
    await clickButton(container, 'Create user');

    const createUserCall = fetchMock.mock.calls.find((call) => {
      const url = String(call[0]);
      const method = ((call[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase();
      return url.includes('/users') && method === 'POST';
    });

    expect(createUserCall).toBeDefined();

    const payload = JSON.parse(String((createUserCall?.[1] as RequestInit | undefined)?.body ?? '{}')) as {
      username?: string;
      displayName?: string;
    };
    expect(payload.username).toBe('new.employee');
    expect(payload.displayName).toBe('new.employee');

    await cleanupRender(root, container);
  });
});

const makeEmployeeSelectionFetchMock = () => {
  const auth = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    tokenType: 'Bearer',
    user: {
      id: 'admin-1',
      username: 'admin',
      displayName: 'Admin User',
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  };

  const users = [
    { id: 'admin-1', username: 'admin', displayName: 'Admin User', role: 'ADMIN', status: 'ACTIVE' },
    { id: 'emp-1', username: 'anna', displayName: 'Anna', role: 'EMPLOYEE', status: 'ACTIVE' },
    { id: 'emp-2', username: 'ben', displayName: 'Ben', role: 'EMPLOYEE', status: 'ACTIVE' },
    { id: 'emp-3', username: 'cara', displayName: 'Cara', role: 'EMPLOYEE', status: 'ACTIVE' },
  ];

  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.endsWith('/auth/login') && method === 'POST') {
      return ok(auth);
    }

    if (url.includes('/users') && method === 'GET') {
      return ok(users);
    }

    if (url.includes('/appointments') && method === 'GET') {
      return ok([]);
    }

    if (url.includes('/system-settings/calendar-window') && method === 'GET') {
      return ok({ slotMinTime: '08:00:00', slotMaxTime: '20:00:00' });
    }

    return ok({});
  });
};

const renderAndLoginForEmployeeSelection = async () => {
  setViewportWidth(1280);
  (globalThis as any).EventSource = MockEventSource;
  const fetchMock = makeEmployeeSelectionFetchMock();
  vi.stubGlobal('fetch', fetchMock);

  const container = document.createElement('div');
  document.body.appendChild(container);

  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(I18nProvider, null, React.createElement(App)));
  });

  const loginForm = container.querySelector('form');
  if (!loginForm) {
    throw new Error('Login form not found');
  }

  const loginInputs = Array.from(loginForm.querySelectorAll('input')) as HTMLInputElement[];
  await setControlValue(loginInputs[0], 'admin');
  await setControlValue(loginInputs[1], 'admin123');

  await act(async () => {
    loginForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  await waitFor(() => container.textContent?.includes('Signed in as') ?? false);
  await flush();

  return { container, root };
};

const openEmployeeDropdown = async (container: HTMLElement) => {
  const toggle = container.querySelector('.employee-dropdown-toggle') as HTMLButtonElement | null;
  if (!toggle) {
    throw new Error('Employee dropdown toggle not found');
  }
  await clickElement(toggle);
};

const findEmployeeCheckbox = (container: HTMLElement, displayName: string) => {
  const options = Array.from(container.querySelectorAll('.employee-dropdown-panel .checkbox-option'));
  const match = options.find((option) => option.textContent?.trim() === displayName);
  return (match?.querySelector('input[type="checkbox"]') ?? null) as HTMLInputElement | null;
};

const toggleCheckbox = async (checkbox: HTMLInputElement) => {
  await act(async () => {
    checkbox.click();
  });
};

describe('App employee selection checkbox behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '';
    setMockCalendarNoteState(false);
    setMobilePointerMode(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('replaces the previously checked employee instead of adjusting party size when party size is 1', async () => {
    const { container, root } = await renderAndLoginForEmployeeSelection();

    const partySizeInput = findControlInLabel(container, 'Party size', 'input') as HTMLInputElement | null;
    expect(partySizeInput?.value).toBe('1');

    await openEmployeeDropdown(container);
    const annaCheckbox = findEmployeeCheckbox(container, 'Anna');
    const benCheckbox = findEmployeeCheckbox(container, 'Ben');
    expect(annaCheckbox).not.toBeNull();
    expect(benCheckbox).not.toBeNull();

    await toggleCheckbox(annaCheckbox as HTMLInputElement);
    expect((annaCheckbox as HTMLInputElement).checked).toBe(true);

    await toggleCheckbox(benCheckbox as HTMLInputElement);

    expect((benCheckbox as HTMLInputElement).checked).toBe(true);
    expect((annaCheckbox as HTMLInputElement).checked).toBe(false);
    expect((partySizeInput as HTMLInputElement).value).toBe('1');

    await cleanupRender(root, container);
  });

  it('blocks checking an extra employee and shows a notice once selected count reaches party size', async () => {
    const { container, root } = await renderAndLoginForEmployeeSelection();

    const partySizeInput = findControlInLabel(container, 'Party size', 'input') as HTMLInputElement | null;
    expect(partySizeInput).not.toBeNull();
    await setControlValue(partySizeInput as HTMLInputElement, '2');

    await openEmployeeDropdown(container);
    const annaCheckbox = findEmployeeCheckbox(container, 'Anna');
    const benCheckbox = findEmployeeCheckbox(container, 'Ben');
    const caraCheckbox = findEmployeeCheckbox(container, 'Cara');
    expect(annaCheckbox).not.toBeNull();
    expect(benCheckbox).not.toBeNull();
    expect(caraCheckbox).not.toBeNull();

    await toggleCheckbox(annaCheckbox as HTMLInputElement);
    await toggleCheckbox(benCheckbox as HTMLInputElement);

    expect((annaCheckbox as HTMLInputElement).checked).toBe(true);
    expect((benCheckbox as HTMLInputElement).checked).toBe(true);

    await toggleCheckbox(caraCheckbox as HTMLInputElement);

    expect((caraCheckbox as HTMLInputElement).checked).toBe(false);
    expect((annaCheckbox as HTMLInputElement).checked).toBe(true);
    expect((benCheckbox as HTMLInputElement).checked).toBe(true);
    expect((partySizeInput as HTMLInputElement).value).toBe('2');

    const notice = container.querySelector('.message.error');
    expect(notice?.textContent).toContain('reached the party size');

    await cleanupRender(root, container);
  });
});
