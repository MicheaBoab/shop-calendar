// @vitest-environment jsdom
import React, { act, useEffect, useImperativeHandle, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { I18nProvider } from './i18n/i18n';

vi.mock('@fullcalendar/react', () => {
  const MockFullCalendar = React.forwardRef<any, any>((_props, ref) => {
    const calendarRootRef = useRef<HTMLDivElement | null>(null);

    useImperativeHandle(ref, () => ({
      getApi: () => ({
        getDate: () => new Date(2026, 6, 30, 10, 0, 0, 0),
        prev: vi.fn(),
        next: vi.fn(),
        gotoDate: vi.fn(),
      }),
    }));

    useEffect(() => {}, []);

    return React.createElement('div', { 'data-testid': 'mock-calendar', ref: calendarRootRef });
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

interface ShopFixture {
  id: string;
  name: string;
}

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

interface FetchMockOptions {
  role: TestRole;
  needsShopSelection: boolean;
  activeShopId?: string;
  shops: ShopFixture[];
  shopsFetch?: 'immediate' | 'pending' | 'error';
}

const buildAuth = (role: TestRole, needsShopSelection: boolean, activeShopId?: string) => ({
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
  needsShopSelection,
  activeShopId: activeShopId ?? null,
});

const makeFetchMock = (options: FetchMockOptions) => {
  const { role, shops } = options;
  let pendingShopsResolvers: Array<() => void> = [];

  const users = [
    { id: 'emp-1', username: 'anna', displayName: 'Anna', role: 'EMPLOYEE', status: 'ACTIVE' },
    {
      id: role === 'ADMIN' ? 'admin-1' : 'emp-logged-in',
      username: role === 'ADMIN' ? 'admin' : 'employee',
      displayName: role === 'ADMIN' ? 'Admin User' : 'Employee User',
      role,
      status: 'ACTIVE',
    },
  ];

  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  const fail = (message: string) => Promise.resolve(new Response(JSON.stringify({ message }), { status: 500 }));

  const releasePendingShops = () => {
    const resolvers = pendingShopsResolvers;
    pendingShopsResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  };

  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.endsWith('/auth/login') && method === 'POST') {
      return ok(buildAuth(options.role, options.needsShopSelection, options.activeShopId));
    }

    if (url.endsWith('/auth/select-shop') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { shopId?: string };
      return ok(buildAuth(options.role, false, body.shopId));
    }

    if (url.endsWith('/shops') && method === 'GET') {
      if (options.shopsFetch === 'error') {
        return fail('Shops unavailable');
      }

      if (options.shopsFetch === 'pending') {
        return new Promise<Response>((resolve) => {
          pendingShopsResolvers.push(() => resolve(new Response(JSON.stringify(shops), { status: 200 })));
        });
      }

      return ok(shops);
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

  return { fetchMock, releasePendingShops };
};

const renderApp = () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const root = createRoot(container);

  return { container, root };
};

const login = async (container: HTMLElement, role: TestRole) => {
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
};

const cleanupRender = async (root: Root, container: HTMLElement) => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
};

describe('App shop selection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '';
    setViewportWidth(1280);
    (globalThis as any).EventSource = MockEventSource;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the shop selection dropdown and Continue button for an admin whose login requires shop selection', async () => {
    const shops: ShopFixture[] = [
      { id: 'shop-1', name: 'Main St' },
      { id: 'shop-2', name: 'Second St' },
    ];
    const { fetchMock } = makeFetchMock({ role: 'ADMIN', needsShopSelection: true, shops });
    vi.stubGlobal('fetch', fetchMock);

    const { container, root } = renderApp();
    await act(async () => {
      root.render(React.createElement(I18nProvider, null, React.createElement(App)));
    });

    await login(container, 'ADMIN');
    await waitFor(() => container.textContent?.includes('Select a shop') ?? false);

    expect(container.textContent).toContain('Choose which shop you want to manage.');

    const select = container.querySelector('select') as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    const optionLabels = Array.from(select!.querySelectorAll('option')).map((option) => option.textContent?.trim());
    expect(optionLabels).toEqual(['Main St', 'Second St']);

    const continueButton = findButtonByLabel(container, 'Continue');
    expect(continueButton).not.toBeNull();
    expect(continueButton?.disabled).toBe(false);

    // Signed-in dashboard has not been reached yet.
    expect(container.textContent).not.toContain('Signed in as');

    await cleanupRender(root, container);
  });

  it('lets an employee sign in directly without a shop selection step', async () => {
    const { fetchMock } = makeFetchMock({ role: 'EMPLOYEE', needsShopSelection: false, shops: [] });
    vi.stubGlobal('fetch', fetchMock);

    const { container, root } = renderApp();
    await act(async () => {
      root.render(React.createElement(I18nProvider, null, React.createElement(App)));
    });

    await login(container, 'EMPLOYEE');
    await waitFor(() => container.textContent?.includes('Signed in as') ?? false);

    expect(container.textContent).not.toContain('Select a shop');
    expect(container.querySelector('.modal-overlay')).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/shops'))).toBe(false);

    await cleanupRender(root, container);
  });

  it('confirms the selected shop and completes sign-in with the chosen shopId', async () => {
    const shops: ShopFixture[] = [
      { id: 'shop-1', name: 'Main St' },
      { id: 'shop-2', name: 'Second St' },
    ];
    const { fetchMock } = makeFetchMock({ role: 'ADMIN', needsShopSelection: true, shops });
    vi.stubGlobal('fetch', fetchMock);

    const { container, root } = renderApp();
    await act(async () => {
      root.render(React.createElement(I18nProvider, null, React.createElement(App)));
    });

    await login(container, 'ADMIN');
    await waitFor(() => container.textContent?.includes('Select a shop') ?? false);

    const select = container.querySelector('select') as HTMLSelectElement;
    await setControlValue(select, 'shop-2');

    await clickButton(container, 'Continue');
    await waitFor(() => container.textContent?.includes('Signed in as') ?? false);

    expect(container.textContent).not.toContain('Select a shop');

    const selectShopCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/auth/select-shop'));
    expect(selectShopCall).toBeDefined();
    const body = JSON.parse(String(selectShopCall?.[1]?.body ?? '{}'));
    expect(body).toEqual({ shopId: 'shop-2' });

    await cleanupRender(root, container);
  });

  it('opens the switch-shop entry point for admins and closes it again via Cancel without changing auth', async () => {
    const shops: ShopFixture[] = [
      { id: 'shop-1', name: 'Main St' },
      { id: 'shop-2', name: 'Second St' },
    ];
    const { fetchMock } = makeFetchMock({
      role: 'ADMIN',
      needsShopSelection: false,
      activeShopId: 'shop-1',
      shops,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container, root } = renderApp();
    await act(async () => {
      root.render(React.createElement(I18nProvider, null, React.createElement(App)));
    });

    await login(container, 'ADMIN');
    await waitFor(() => container.textContent?.includes('Signed in as') ?? false);
    await waitFor(() => container.textContent?.includes('Switch shop (Main St)') ?? false);

    await clickButton(container, 'Switch shop (Main St)');

    const modal = container.querySelector('.modal-overlay');
    expect(modal).not.toBeNull();
    expect(modal?.getAttribute('role')).toBe('dialog');
    expect(modal?.getAttribute('aria-modal')).toBe('true');
    expect(modal?.textContent).toContain('Select a shop');

    await clickButton(container, 'Cancel');

    expect(container.querySelector('.modal-overlay')).toBeNull();
    expect(container.textContent).toContain('Signed in as');

    await cleanupRender(root, container);
  });

  it('shows a loading indicator while shops are being fetched and an error message when the fetch fails', async () => {
    const shops: ShopFixture[] = [{ id: 'shop-1', name: 'Main St' }];
    const { fetchMock, releasePendingShops } = makeFetchMock({
      role: 'ADMIN',
      needsShopSelection: true,
      shops,
      shopsFetch: 'pending',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container, root } = renderApp();
    await act(async () => {
      root.render(React.createElement(I18nProvider, null, React.createElement(App)));
    });

    await login(container, 'ADMIN');
    await waitFor(() => container.textContent?.includes('Loading shops...') ?? false);

    expect(container.querySelector('select')).toBeNull();
    expect(findButtonByLabel(container, 'Continue')).toBeNull();

    await act(async () => {
      releasePendingShops();
      await Promise.resolve();
    });
    await flush();

    await waitFor(() => container.querySelector('select') !== null);
    expect(container.textContent).not.toContain('Loading shops...');

    await cleanupRender(root, container);
  });

  it('shows an error message when loading shops fails', async () => {
    const { fetchMock } = makeFetchMock({
      role: 'ADMIN',
      needsShopSelection: true,
      shops: [],
      shopsFetch: 'error',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container, root } = renderApp();
    await act(async () => {
      root.render(React.createElement(I18nProvider, null, React.createElement(App)));
    });

    await login(container, 'ADMIN');
    await waitFor(() => container.textContent?.includes('Shops unavailable') ?? false);

    const errorMessage = Array.from(container.querySelectorAll('p')).find((p) => p.textContent?.includes('Shops unavailable'));
    expect(errorMessage).toBeDefined();
    expect(errorMessage?.className).toContain('error');
    expect(container.querySelector('select')?.querySelectorAll('option').length ?? 0).toBe(0);

    await cleanupRender(root, container);
  });
});
