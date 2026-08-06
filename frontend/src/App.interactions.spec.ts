// @vitest-environment jsdom
import React, { act, useImperativeHandle } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { I18nProvider } from './i18n/i18n';

vi.mock('@fullcalendar/react', () => {
  const MockFullCalendar = React.forwardRef<any, any>((props, ref) => {
    useImperativeHandle(ref, () => ({
      getApi: () => ({
        getDate: () => new Date(2026, 6, 30, 10, 0, 0, 0),
        prev: vi.fn(),
        next: vi.fn(),
        gotoDate: vi.fn(),
      }),
    }));

    return React.createElement(
      'div',
      { 'data-testid': 'mock-calendar' },
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
