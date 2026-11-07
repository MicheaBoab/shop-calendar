// @vitest-environment jsdom
import React, { act, useEffect, useImperativeHandle, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { I18nProvider } from "./i18n/i18n";

const appStylesheet = readFileSync("src/styles.css", "utf8");

const calendarPropsSpy = vi.hoisted(() => vi.fn());
const calendarGotoSpy = vi.hoisted(() => vi.fn());

// jsdom does not implement native dialog methods; real-browser modal behavior is provided by showModal.
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value() { this.setAttribute("open", ""); this.querySelector("button")?.focus(); } },
  close: { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } },
});

vi.mock("@fullcalendar/react", () => {
  const MockFullCalendar = React.forwardRef<any, any>((props, ref) => {
    calendarPropsSpy(props);
    const calendarRootRef = useRef<HTMLDivElement | null>(null);
    const anchor = useRef(new Date(props.initialDate));

    useImperativeHandle(ref, () => ({
      getApi: () => {
        const sync = () => props.datesSet?.({ start: new Date(anchor.current) });
        const move = (direction: number) => {
          const next = new Date(anchor.current);
          next.setDate(next.getDate() + direction * (props.initialView === "timeGridThreeDay" ? 3 : 1));
          anchor.current = next; sync();
        };
        return {
          getDate: () => new Date(anchor.current),
          prev: () => move(-1),
          next: () => move(1),
          gotoDate: (date: Date) => { calendarGotoSpy(date); anchor.current = new Date(date); sync(); },
        };
      },
    }));

    useEffect(() => {
      if (!calendarRootRef.current) {
        return undefined;
      }

      const noteText =
        (globalThis as any).__TEST_CALENDAR_NOTE_TEXT ?? "Color service note";
      const isTruncated = Boolean(
        (globalThis as any).__TEST_CALENDAR_NOTE_TRUNCATED,
      );

      const eventHost = document.createElement("div");
      const noteElement = document.createElement("div");
      noteElement.className = "calendar-event-note";
      noteElement.textContent = noteText;

      Object.defineProperties(noteElement, {
        clientWidth: {
          configurable: true,
          get: () => (isTruncated ? 64 : 120),
        },
        scrollWidth: {
          configurable: true,
          get: () => (isTruncated ? 140 : 120),
        },
        clientHeight: {
          configurable: true,
          get: () => (isTruncated ? 20 : 40),
        },
        scrollHeight: {
          configurable: true,
          get: () => (isTruncated ? 44 : 40),
        },
      });

      eventHost.appendChild(noteElement);
      calendarRootRef.current.prepend(eventHost);
      props.eventDidMount?.({ el: eventHost });

      return () => {
        props.eventWillUnmount?.({ el: eventHost });
        eventHost.remove();
      };
    }, [props.eventDidMount, props.eventWillUnmount]);

    return React.createElement(
      "div",
      { "data-testid": "mock-calendar", ref: calendarRootRef },
      ...(props.events ?? []).map((event: any) =>
        React.createElement(
          "div",
          {
            key: event.id,
            className: ["mock-calendar-event", ...(event.classNames ?? [])]
              .filter(Boolean)
              .join(" "),
            "data-editable": String(event.editable ?? true),
            style: {
              background: event.backgroundColor,
              borderColor: event.borderColor,
              color: event.textColor,
            },
          },
          props.eventContent?.({
            event: {
              id: event.id,
              title: event.title,
              start: event.start ? new Date(event.start) : null,
              end: event.end ? new Date(event.end) : null,
              extendedProps: event.extendedProps ?? {},
            },
            timeText: "14:00 - 15:00",
          }) ?? event.title,
        ),
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () =>
            props.dateClick?.({ date: new Date(2026, 6, 30, 14, 30, 0, 0) }),
        },
        "Mock date click",
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () =>
            props.eventClick?.({
              event: {
                id: (globalThis as any).__TEST_EVENT_CLICK_ID__ ?? "appt-1",
              },
            }),
        },
        "Mock event click",
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => props.eventDrop?.({
            event: {
              id: "appt-1",
              extendedProps: { appointmentId: "appt-1" },
              start: new Date(2026, 6, 30, 15, 0, 0, 0),
              end: new Date(2026, 6, 30, 16, 0, 0, 0),
            },
            revert: () => (globalThis as any).__TEST_EVENT_REVERT__?.(),
          }),
        },
        "Mock event drop",
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => props.eventResize?.({
            event: {
              id: "appt-1",
              extendedProps: { appointmentId: "appt-1" },
              start: new Date(2026, 6, 30, 14, 0, 0, 0),
              end: new Date(2026, 6, 30, 16, 0, 0, 0),
            },
            revert: () => (globalThis as any).__TEST_EVENT_REVERT__?.(),
          }),
        },
        "Mock event resize",
      ),
    );
  });

  return { default: MockFullCalendar };
});

class MockEventSource {
  static instances: MockEventSource[] = [];
  private listeners = new Map<string, EventListener[]>();
  closed = false;

  constructor() {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(entry => entry !== listener));
  }

  emit(type: string) {
    const listeners = this.listeners.get(type) ?? [];
    for (const listener of listeners) {
      listener(new Event(type));
    }
    return listeners.length;
  }

  close() {
    this.closed = true;
  }
}

type TestRole = "ADMIN" | "EMPLOYEE" | "MANAGER" | "SHOP_ACCOUNT";

type TestFetchOptions = {
  users?: Array<Record<string, unknown>>;
  appointments?: Array<Record<string, unknown>>;
  auditLogs?: Array<Record<string, unknown>>;
  activeShopId?: string;
  shops?: Array<Record<string, unknown>>;
  calendarWindow?: { slotMinTime: string; slotMaxTime: string };
  calendarWindowUnavailable?: boolean;
};

const testRoleName = (role: TestRole) => {
  if (role === "ADMIN") {
    return "admin";
  }

  if (role === "MANAGER") return "manager";
  return role === "SHOP_ACCOUNT" ? "shop" : "employee";
};

const testRoleDisplayName = (role: TestRole) => {
  if (role === "ADMIN") {
    return "Admin User";
  }

  if (role === "MANAGER") return "Manager User";
  return role === "SHOP_ACCOUNT" ? "Shop Login" : "Employee User";
};

const setMockCalendarNoteState = (
  isTruncated: boolean,
  noteText = "Color service note",
) => {
  (globalThis as any).__TEST_CALENDAR_NOTE_TRUNCATED = isTruncated;
  (globalThis as any).__TEST_CALENDAR_NOTE_TEXT = noteText;
};

const setMockEventClickId = (id: string) => {
  (globalThis as any).__TEST_EVENT_CLICK_ID__ = id;
};

const setMobilePointerMode = (isMobilePointer: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: isMobilePointer,
      media: "(hover: none), (pointer: coarse)",
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
  Object.defineProperty(window, "innerWidth", {
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
      throw new Error("Timed out waiting for condition");
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
};

const findButtonByLabel = (container: HTMLElement, label: string) => {
  return (
    Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null
  );
};

const clickButton = async (container: HTMLElement, label: string) => {
  const button = findButtonByLabel(container, label);
  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }

  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const clickElement = async (element: HTMLElement) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const findControlInLabel = (
  container: HTMLElement,
  labelText: string,
  selector: "input" | "textarea" | "select" = "input",
) => {
  const labels = Array.from(container.querySelectorAll("label"));
  const match = labels.find((label) => label.textContent?.includes(labelText));
  if (!match) {
    return null;
  }

  return match.htmlFor
    ? container.querySelector(`[id="${match.htmlFor}"]`)
    : match.querySelector(selector);
};

const setControlValue = async (
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) => {
  await act(async () => {
    const prototype = Object.getPrototypeOf(control);
    const valueSetter = Object.getOwnPropertyDescriptor(
      prototype,
      "value",
    )?.set;
    if (valueSetter) {
      valueSetter.call(control, value);
    } else {
      control.value = value;
    }
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const chooseAppointmentDate = async (container: HTMLElement, date: Date) => {
  await clickButton(container, "Choose date");
  const label = `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
  await clickElement(container.querySelector(`.appointment-date-grid button[aria-label="${label}"]`)!);
};

const makeFetchMock = (role: TestRole, options: TestFetchOptions = {}) => {
  const auth = {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenType: "Bearer",
    user: {
      id: role === "ADMIN"
        ? "admin-1"
        : role === "MANAGER"
          ? "manager-logged-in"
          : role === "SHOP_ACCOUNT"
            ? "shop-account-logged-in"
            : "emp-logged-in",
      username: testRoleName(role),
      displayName: testRoleDisplayName(role),
      role,
      status: "ACTIVE",
    },
    activeShopId: options.activeShopId ?? "shop-1",
  };

  const users = options.users ?? [
    {
      id: "emp-1",
      username: "anna",
      displayName: "Anna",
      role: "EMPLOYEE",
      status: "ACTIVE",
    },
    {
      id: auth.user.id,
      username: auth.user.username,
      displayName: auth.user.displayName,
      role,
      status: "ACTIVE",
    },
  ];

  const today = new Date();
  const firstStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    14,
    0,
    0,
    0,
  );
  const firstEnd = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    15,
    0,
    0,
    0,
  );
  const cancelledStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    16,
    0,
    0,
    0,
  );
  const cancelledEnd = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    17,
    0,
    0,
    0,
  );

  const appointments = options.appointments ?? [
    {
      id: "appt-1",
      employeeId: "emp-1",
      startAt: firstStart.toISOString(),
      endAt: firstEnd.toISOString(),
      phone: "1234567890",
      price: "80.00",
      customerName: "Chris",
      note: "Color service",
      status: "ACTIVE",
    },
    {
      id: "appt-2",
      employeeId: "emp-1",
      startAt: cancelledStart.toISOString(),
      endAt: cancelledEnd.toISOString(),
      phone: "5551234567",
      price: "45.00",
      customerName: "Morgan",
      note: "Cancelled service",
      status: "CANCELLED",
    },
  ];

  const ok = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  const shops = options.shops ?? [{ id: "shop-1", name: "Main St" }];
  let reassignedColor: string | null = null;

  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.endsWith("/auth/login") && method === "POST") {
      return ok(auth);
    }

    if (url.includes("/emp-1/color-preview") && method === "GET") {
      const excluded = new URL(url).searchParams.get("excluded")?.split(",") ?? [];
      const candidateColor = ["#f87171", "#f472b6", "#22d3ee"].find(color => !excluded.includes(color));
      return ok(candidateColor
        ? { currentColor: reassignedColor ?? "#60a5fa", candidateColor, previewToken: `signed-${candidateColor}` }
        : { currentColor: reassignedColor ?? "#60a5fa", candidateColor: null, exhausted: true });
    }
    if (url.endsWith("/emp-1/color") && method === "PATCH") {
      reassignedColor = JSON.parse(String(init?.body)).candidateColor;
      appointments.forEach((appointment) => {
        if (appointment.employeeId === "emp-1") {
          appointment.employeeColor = reassignedColor;
        }
      });
      return ok({ id: "emp-1", color: reassignedColor });
    }
    if (url.includes("/users") && method === "GET") {
      return ok(users.map((user, index) => ({
        ...user,
        color: (user.id === "emp-1" ? reassignedColor : null) ?? user.color ?? ['#60a5fa', '#4ade80', '#f472b6', '#facc15'][index % 4],
      })));
    }

    if (url.includes("/appointments") && method === "GET") {
      return ok(appointments);
    }

    if (url.includes("/audit/logs") && method === "GET") {
      return ok({ items: options.auditLogs ?? [], total: options.auditLogs?.length ?? 0 });
    }

    if (url.includes("/system-settings/calendar-window") && method === "GET") {
      if ("calendarWindowUnavailable" in options && options.calendarWindowUnavailable) {
        return Promise.resolve(new Response(JSON.stringify({ message: "Calendar settings unavailable" }), { status: 503 }));
      }
      return ok(options.calendarWindow ?? { slotMinTime: "08:00:00", slotMaxTime: "20:00:00" });
    }

    if (url.endsWith("/shops") && method === "GET") {
      return ok(shops);
    }

    if (url.includes("/appointments/appt-1") && method === "DELETE") {
      return ok({ success: true });
    }

    if (url.includes("/appointments/appt-1/cancel") && method === "POST") {
      return ok({ success: true });
    }

    if (url.includes("/appointments/appt-2") && method === "DELETE") {
      return ok({ success: true });
    }

    if (url.includes("/appointments/appt-2/cancel") && method === "POST") {
      return ok({ success: true });
    }

    return ok({});
  });
};

const renderAndLogin = async (
  role: TestRole,
  viewportWidth: number,
  options: TestFetchOptions = {},
) => {
  setViewportWidth(viewportWidth);
  (globalThis as any).EventSource = MockEventSource;
  const fetchMock = makeFetchMock(role, options);
  vi.stubGlobal("fetch", fetchMock);

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(I18nProvider, null, React.createElement(App)),
    );
  });

  const loginForm = container.querySelector("form");
  if (!loginForm) {
    throw new Error("Login form not found");
  }

  const loginInputs = Array.from(
    loginForm.querySelectorAll("input"),
  ) as HTMLInputElement[];
  const usernameInput = loginInputs[0] ?? null;
  const passwordInput = loginInputs[1] ?? null;
  if (!usernameInput || !passwordInput) {
    throw new Error("Login inputs not found");
  }

  await setControlValue(usernameInput, testRoleName(role));
  await setControlValue(passwordInput, "admin123");

  await act(async () => {
    loginForm.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });

  await waitFor(() => Boolean(container.textContent?.includes("Signed in as") || container.textContent?.includes("已登录为")));
  await flush();

  return { container, root, fetchMock };
};

const cleanupRender = async (root: Root, container: HTMLElement) => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
};

describe("App interaction seams", () => {
  // Success-path contracts complement the failure/recovery tests below.
  it.each(["ADMIN", "MANAGER", "EMPLOYEE", "SHOP_ACCOUNT"] as const)(
    "%s submits optional-price, partially assigned group bookings with the default 60 minutes",
    async (role) => {
      const { container, root, fetchMock } = await renderAndLogin(role, 1280);
      try {
        const future = new Date();
        future.setDate(future.getDate() + 1);
        await chooseAppointmentDate(container, future);
        await setControlValue(container.querySelector("#appointment-start-time")!, "230");
        await setControlValue(findControlInLabel(container, "Phone") as HTMLInputElement, "3125550101");
        await setControlValue(container.querySelector(".party-size-control input")!, "3");
        await openEmployeeDropdown(container);
        await toggleCheckbox(findEmployeeCheckbox(container, "Anna")!);
        await clickButton(container, "Create appointment");
        const writes = fetchMock.mock.calls.filter(([url, init]) =>
          String(url).endsWith("/appointments") && init?.method === "POST");
        expect(writes).toHaveLength(1);
        const payload = JSON.parse(String(writes[0][1]!.body));
        expect(payload).toMatchObject({ employeeIds: ["emp-1"], partySize: 3, phone: "3125550101" });
        expect(payload).not.toHaveProperty("price");
        expect(new Date(payload.endAt).getTime() - new Date(payload.startAt).getTime()).toBe(60 * 60_000);
        expect(findButtonByLabel(container, "Create appointment")).not.toBeNull();
        expect((findControlInLabel(container, "Phone") as HTMLInputElement).value).not.toContain("312");
      } finally { await cleanupRender(root, container); }
    },
  );

  it.each(["ADMIN", "MANAGER", "EMPLOYEE", "SHOP_ACCOUNT"] as const)(
    "%s cancels only after confirmation and returns the editor to create mode",
    async (role) => {
      const { container, root, fetchMock } = await renderAndLogin(role, 1280);
      try {
        await clickButton(container, "Mock event click");
        const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
        await clickButton(container, "Cancel appointment");
        const writes = () => fetchMock.mock.calls.filter(([url, init]) =>
          String(url).endsWith("/appt-1/cancel") && init?.method === "POST");
        expect(writes()).toHaveLength(0);
        expect(findButtonByLabel(container, "Update appointment")).not.toBeNull();
        confirm.mockReturnValue(true);
        await clickButton(container, "Cancel appointment");
        expect(writes()).toHaveLength(1);
        expect(findButtonByLabel(container, "Create appointment")).not.toBeNull();
      } finally { await cleanupRender(root, container); }
    },
  );

  it.each(["ADMIN", "MANAGER"] as const)("%s hides appointments only after confirmation", async (role) => {
    const { container, root, fetchMock } = await renderAndLogin(role, 1280);
    try {
      await clickButton(container, "Mock event click");
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      await clickButton(container, "Delete appointment");
      const writes = () => fetchMock.mock.calls.filter(([url, init]) =>
        String(url).endsWith("/appt-1") && init?.method === "DELETE");
      expect(writes()).toHaveLength(0);
      confirm.mockReturnValue(true);
      await clickButton(container, "Delete appointment");
      expect(writes()).toHaveLength(1);
      expect(findButtonByLabel(container, "Create appointment")).not.toBeNull();
    } finally { await cleanupRender(root, container); }
  });

  it.each(["Mock event drop", "Mock event resize"])(
    "%s writes both instants, refreshes after success and reverts on conflict",
    async (action) => {
      const { container, root, fetchMock } = await renderAndLogin("EMPLOYEE", 1280);
      try {
        const revert = vi.fn();
        (globalThis as any).__TEST_EVENT_REVERT__ = revert;
        const readsBefore = fetchMock.mock.calls.filter(([url, init]) =>
          String(url).includes("/appointments") && !init?.method).length;
        await clickButton(container, action);
        const writes = fetchMock.mock.calls.filter(([url, init]) =>
          String(url).endsWith("/appt-1") && init?.method === "PATCH");
        expect(writes).toHaveLength(1);
        expect(JSON.parse(String(writes[0][1]!.body))).toMatchObject({
          startAt: new Date(2026, 6, 30, action.includes("drop") ? 15 : 14).toISOString(),
          endAt: new Date(2026, 6, 30, 16).toISOString(),
          updatedById: "emp-logged-in",
        });
        expect(fetchMock.mock.calls.filter(([url, init]) =>
          String(url).includes("/appointments") && !init?.method).length).toBeGreaterThan(readsBefore);
        expect(revert).not.toHaveBeenCalled();
        fetchMock.mockImplementationOnce(() => Promise.resolve(
          new Response(JSON.stringify({ message: "Appointment overlap" }), { status: 409 })));
        await clickButton(container, action);
        expect(revert).toHaveBeenCalledTimes(1);
        expect(container.querySelector("dialog[open]")?.textContent).toContain("overlaps another appointment");
      } finally { delete (globalThis as any).__TEST_EVENT_REVERT__; await cleanupRender(root, container); }
    },
  );

  it.each(["EMPLOYEE", "MANAGER", "SHOP_ACCOUNT"] as const)(
    "admin creates %s with matching passwords and refreshes the roster",
    async (role) => {
      const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
      try {
        await clickButton(container, "Admin");
        const form = container.querySelector<HTMLInputElement>('input[name="username"]')!.form!;
        await setControlValue(form.querySelector('[name="username"]')!, "guide.staff");
        await setControlValue(form.querySelector('[name="password"]')!, "fictional-test-only");
        await setControlValue(form.querySelector('[name="confirmPassword"]')!, "different");
        await setControlValue(form.querySelector('[name="role"]')!, role);
        await clickButton(container, "Create user");
        const writes = () => fetchMock.mock.calls.filter(([url, init]) =>
          String(url).endsWith("/users") && init?.method === "POST");
        expect(writes()).toHaveLength(0);
        await clickButton(container, "Got it");
        await setControlValue(form.querySelector('[name="confirmPassword"]')!, "fictional-test-only");
        await clickButton(container, "Create user");
        expect(writes()).toHaveLength(1);
        expect(JSON.parse(String(writes()[0][1]!.body))).toMatchObject({
          username: "guide.staff", displayName: "guide.staff", role,
        });
        expect((form.querySelector('[name="username"]') as HTMLInputElement).value).toBe("");
      } finally { await cleanupRender(root, container); }
    },
  );

  it.each([
    ["ACTIVE", "Disable", "INACTIVE"],
    ["INACTIVE", "Enable", "ACTIVE"],
  ])("admin changes %s account status and confirms removal of the intended user", async (status, action, nextStatus) => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280, {
      users: [{ id: "emp-1", username: "anna", displayName: "Anna", role: "EMPLOYEE", status }],
    });
    try {
      await clickButton(container, "Admin");
      const anna = [...container.querySelectorAll<HTMLElement>(".user-item")]
        .find(row => row.textContent?.includes("Anna"))!;
      await clickButton(anna, action);
      expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/emp-1/status")
        && init?.method === "PATCH" && JSON.parse(String(init.body)).status === nextStatus)).toBe(true);
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      await clickButton(anna, "Remove");
      expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/emp-1") && init?.method === "DELETE")).toBe(false);
      confirm.mockReturnValue(true);
      await clickButton(anna, "Remove");
      expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/emp-1") && init?.method === "DELETE")).toHaveLength(1);
    } finally { await cleanupRender(root, container); }
  });

  it.each(["emp-1", "admin-1"])("admin resets %s password; only self-reset clears the current session", async (id) => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    try {
      await clickButton(container, "Admin");
      const newPassword = container.querySelector<HTMLInputElement>('input[name="newPassword"]')!;
      const form = newPassword.form!;
      await setControlValue(form.querySelector('[name="targetUserId"]')!, id);
      await setControlValue(newPassword, "fictional-reset-only");
      await setControlValue(form.querySelector('[name="confirmPassword"]')!, "fictional-reset-only");
      await clickButton(container, "Reset password");
      const writes = fetchMock.mock.calls.filter(([url, init]) =>
        String(url).endsWith(`/users/${id}/password`) && init?.method === "PATCH");
      expect(writes).toHaveLength(1);
      expect(JSON.parse(String(writes[0][1]!.body))).toEqual({ newPassword: "fictional-reset-only" });
      if (id === "admin-1") {
        expect(localStorage.getItem("shop-calendar-auth")).toBeNull();
        expect(findButtonByLabel(container, "Sign in")).not.toBeNull();
      } else {
        expect(localStorage.getItem("shop-calendar-auth")).not.toBeNull();
        expect(newPassword.value).toBe("");
      }
    } finally { await cleanupRender(root, container); }
  });

  it("signs out locally, removes saved authentication and closes the live stream", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);
    try {
      expect(localStorage.getItem("shop-calendar-auth")).not.toBeNull();
      await clickButton(container, "Sign out");
      expect(localStorage.getItem("shop-calendar-auth")).toBeNull();
      expect(findButtonByLabel(container, "Sign in")).not.toBeNull();
      expect(MockEventSource.instances.every(stream => stream.closed)).toBe(true);
    } finally { await cleanupRender(root, container); }
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    calendarPropsSpy.mockClear();
    calendarGotoSpy.mockClear();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).__TEST_EVENT_REVERT__ = vi.fn();
    MockEventSource.instances = [];
    localStorage.setItem("shop-calendar-locale", "en");
    document.body.innerHTML = "";
    setMockCalendarNoteState(false);
    setMockEventClickId("appt-1");
    setMobilePointerMode(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["employee-help", "Employee assignment help"],
    ["start-date-help", "Start date input help"],
    ["duration-help", "End time preview help"],
  ])("reuses accessible focus, Escape, click and outside help for %s", async (id, label) => {
    const { container, root } = await renderAndLogin("ADMIN", 390);
    try {
      const help = container.querySelector(`#${id}`) as HTMLElement;
      const button = container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
      expect(help.hidden).toBe(true);
      expect(help.getAttribute("role")).toBe("tooltip");
      expect(button.getAttribute("aria-controls")).toBe(id);
      await act(async () => { button.focus(); });
      expect(help.hidden).toBe(false);
      expect(button.getAttribute("aria-describedby")).toBe(id);
      await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
      expect(help.hidden).toBe(true);
      await clickElement(button);
      expect(help.hidden).toBe(false);
      await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
      expect(help.hidden).toBe(true);
      const ids = [...container.querySelectorAll('[role="tooltip"]')].map(el => el.id);
      expect(new Set(ids).size).toBe(ids.length);
    } finally { await cleanupRender(root, container); }
  });

  it("removes only placeholder hints and keeps invalid-time errors, valid preview and cross-day preview inline", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 390);
    try {
      const time = container.querySelector("#appointment-start-time") as HTMLInputElement;
      const duration = container.querySelector("#appointment-duration") as HTMLInputElement;
      await setControlValue(time, "2500");
      await act(async () => { time.focus(); time.blur(); });
      expect(container.querySelector("#start-time-error")?.textContent).toContain("1–4 digits");
      expect(container.querySelector("#duration-help")?.textContent).toContain("End preview will appear");
      expect([...container.querySelectorAll(".hint")].some(el => el.textContent?.includes("End preview will appear"))).toBe(false);
      expect([...container.querySelectorAll(".hint")].some(el => el.textContent?.includes("Use MM/DD/YYYY"))).toBe(false);
      expect(container.querySelector(".employee-field > .hint")).toBeNull();
      await setControlValue(time, "10");
      await setControlValue(duration, "60");
      expect(container.querySelector(".duration-preview-error")).toBeNull();
      expect(container.textContent).toContain("Derived end:");
      await setControlValue(duration, "900");
      expect(container.querySelector(".duration-preview-error")?.textContent).toContain("Derived end:");
      await setControlValue(duration, "");
      expect(container.querySelector(".duration-preview-error")).toBeNull();
      expect([...container.querySelectorAll(".hint")].some(el => el.textContent?.includes("Derived end:"))).toBe(false);
    } finally { await cleanupRender(root, container); }
  });

  it("keeps only Today and Choose date, uses local dates and never overwrites time/customer or adds a past minimum", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 390);
    try {
      const date = container.querySelector("#appointment-start-date") as HTMLOutputElement;
      const time = container.querySelector("#appointment-start-time") as HTMLInputElement;
      const customer = findControlInLabel(container, "Customer name") as HTMLInputElement;
      const actions = container.querySelector(".quick-date-shortcuts")!;
      expect([...actions.querySelectorAll("button")].map(el => el.textContent)).toEqual(["Today", "Choose date"]);
      await setControlValue(time, "230");
      await setControlValue(customer, "Keep this customer");
      expect(date.tagName).toBe("OUTPUT");
      await act(async () => {
        date.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
        date.dispatchEvent(new Event("paste", { bubbles: true }));
        date.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await clickButton(container, "Today");
      const today = new Date();
      expect(date.value).toBe(`${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}/${today.getFullYear()}`);
      await clickButton(container, "Choose date");
      const panel = container.querySelector(".appointment-date-panel")!;
      expect(panel.querySelector("input")).toBeNull();
      expect(document.activeElement?.getAttribute("aria-label")).toBe(date.value);
      const selected = panel.querySelector<HTMLButtonElement>('.appointment-date-grid button:not([aria-pressed="true"])')!;
      const chosenDate = selected.getAttribute("aria-label");
      await clickElement(selected);
      expect(date.value).toBe(chosenDate);
      expect(container.querySelector('input[type="date"]')).toBeNull();
      expect(document.activeElement?.textContent).toBe("Choose date");
      expect(time.value).toBe("230");
      expect(customer.value).toBe("Keep this customer");
      await clickButton(container, "Choose date");
      expect(document.activeElement?.getAttribute("aria-label")).toBe(chosenDate);
      await clickElement(container.querySelector('.appointment-date-heading button[aria-label="Prev"]')!);
      const pastDay = container.querySelector<HTMLButtonElement>(".appointment-date-grid button")!;
      const pastDate = pastDay.getAttribute("aria-label");
      await clickElement(pastDay);
      expect(date.value).toBe(pastDate);
      expect(time.value).toBe("230");
      expect(customer.value).toBe("Keep this customer");
    } finally { await cleanupRender(root, container); }
  });

  it("localizes new field help and date actions in Chinese", async () => {
    localStorage.setItem("shop-calendar-locale", "zh");
    const { container, root } = await renderAndLogin("ADMIN", 390);
    try {
      expect(container.querySelector('button[aria-label="员工分配说明"]')).not.toBeNull();
      expect(container.querySelector('button[aria-label="开始日期输入说明"]')).not.toBeNull();
      expect(container.querySelector('button[aria-label="结束时间预览说明"]')).not.toBeNull();
      expect(findButtonByLabel(container, "今天")).not.toBeNull();
      await clickButton(container, "选择日期");
      expect(container.querySelector('.appointment-date-panel[aria-label="选择日期"]')).not.toBeNull();
      expect(container.querySelector('.quick-date-shortcuts input')).toBeNull();
    } finally { await cleanupRender(root, container); }
  });

  it("navigates via the displayed date without changing drafts/filter/view, synchronizes navigation and preserves the anchor after slot clicks/remount", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);
    try {
      const date = container.querySelector("#appointment-start-date") as HTMLOutputElement;
      const time = container.querySelector("#appointment-start-time") as HTMLInputElement;
      const customer = findControlInLabel(container, "Customer name") as HTMLInputElement;
      await clickButton(container, "Mock date click");
      await clickButton(container, "3-day");
      await setControlValue(time, "230");
      await setControlValue(customer, "Untouched draft");
      const filter = [...container.querySelectorAll<HTMLButtonElement>(".legend-filter-button")][1];
      await clickElement(filter);
      const strip = container.querySelector(".date-strip")!;
      const trigger = () => strip.querySelector<HTMLButtonElement>(".date-strip-label")!;
      const props = () => calendarPropsSpy.mock.calls[calendarPropsSpy.mock.calls.length - 1][0];
      const label = (d: Date) => new Intl.DateTimeFormat("en-US", {
        year: "numeric", month: "2-digit", day: "2-digit",
      }).format(d);
      const pick = async (value: string) => {
        await clickElement(trigger());
        const panel = document.getElementById(trigger().getAttribute("aria-controls")!)!;
        expect(panel).toBe(strip.querySelector(".native-date-panel"));
        expect(document.activeElement).toBe(panel.querySelector("input"));
        expect(trigger().getAttribute("aria-expanded")).toBe("true");
        await setControlValue(panel.querySelector("input")!, value);
        expect(document.activeElement).toBe(trigger());
        expect(strip.querySelector("input")).toBeNull();
      };
      await pick("2027-12-31");
      expect(calendarGotoSpy).toHaveBeenLastCalledWith(new Date(2027, 11, 31));
      expect(trigger().textContent).toBe(label(new Date(2027, 11, 31)));
      expect(trigger().getAttribute("aria-label")).toBe(trigger().textContent);
      expect(props().initialView).toBe("timeGridThreeDay");
      expect(props().views.timeGridThreeDay.dateAlignment).toBe("day");
      expect(props().views.timeGridThreeDay.dateIncrement).toEqual({ days: 3 });
      expect(date.value).toBe("07/30/2026");
      expect(time.value).toBe("230");
      expect(customer.value).toBe("Untouched draft");
      expect(filter.getAttribute("aria-pressed")).toBe("true");
      await clickElement(strip.querySelectorAll("button")[2]);
      expect(trigger().textContent).toBe(label(new Date(2028, 0, 3)));
      await clickElement(strip.querySelectorAll("button")[0]);
      expect(trigger().textContent).toBe(label(new Date(2027, 11, 31)));
      await clickElement(trigger());
      expect((strip.querySelector("input") as HTMLInputElement).value).toBe("2027-12-31");
      await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
      expect(document.activeElement).toBe(trigger());
      await act(async () => props().dateClick({ date: new Date(2028, 0, 1, 14, 30) }));
      expect(date.value).toBe("01/01/2028");
      expect(time.value).toBe("2:30");
      expect(customer.value).toBe("Untouched draft");
      expect(trigger().textContent).toBe(label(new Date(2027, 11, 31)));
      await clickButton(container, "Day");
      expect(props().initialView).toBe("timeGridDay");
      expect(props().initialDate).toEqual(new Date(2027, 11, 31));
      await pick("2020-02-29");
      expect(trigger().textContent).toBe(label(new Date(2020, 1, 29)));
      await clickElement(strip.querySelectorAll("button")[1]);
      expect(trigger().textContent).toBe(label(new Date()));
      await clickElement(trigger());
      const today = new Date();
      expect((strip.querySelector("input") as HTMLInputElement).value).toBe(
        `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
      );
      expect(date.value).toBe("01/01/2028");
      expect(time.value).toBe("2:30");
      expect(filter.getAttribute("aria-pressed")).toBe("true");
    } finally { await cleanupRender(root, container); }
  });

  it("scopes dark native date styling to the chooser panels, never global or time controls", () => {
    const rules = [...appStylesheet.matchAll(/([^{}]+)\{([^{}]*color-scheme:[^{}]*)\}/g)];
    expect(rules).toHaveLength(1);
    expect(rules[0][1].trim()).toBe('body.theme-dark .native-date-panel,\nbody.theme-dark .native-date-panel input[type="date"]');
    expect(rules[0][2].trim()).toBe("color-scheme: dark;");
    expect(appStylesheet).toContain(".calendar-date-chooser .native-date-panel {\n  position: absolute;");
  });

  it.each([390, 1280])("disables native timed box overlap for day and 3-day at width %i without hiding events", async (width) => {
    const { container, root } = await renderAndLogin("ADMIN", width);
    const assertCalendarOptions = (activeView: string) => {
      const props = calendarPropsSpy.mock.calls[calendarPropsSpy.mock.calls.length - 1][0];
      expect(props.initialView).toBe(activeView);
      expect(props.slotEventOverlap).toBe(false);
      expect(props.nowIndicator).toBe(true);
      for (const view of ["timeGridDay", "timeGridThreeDay"]) {
        const options = { ...props, ...props.views[view] };
        expect(options.slotEventOverlap).toBe(false);
        expect(options.eventMaxStack).toBeUndefined();
        expect(options.dayMaxEvents).toBeUndefined();
        expect(options.dayMaxEventRows).toBeUndefined();
      }
      expect(props.views.timeGridThreeDay).toEqual({
        type: "timeGrid",
        duration: { days: 3 },
        dateAlignment: "day",
        dateIncrement: { days: 3 },
      });

      // Visual box placement must not change drag/business overlap permissions.
      expect(props.eventOverlap).toBeUndefined();
      expect(props.editable).toBe(true);
    };
    try {
      assertCalendarOptions("timeGridDay");
      await clickButton(container, "3-day");
      assertCalendarOptions("timeGridThreeDay");
    } finally {
      await cleanupRender(root, container);
    }
  });

  it("keeps manual view selection through navigation, resize and panel switches, but resets on a new page mount", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);
    const view = () => calendarPropsSpy.mock.calls[calendarPropsSpy.mock.calls.length - 1][0].initialView;
    try {
      expect(view()).toBe("timeGridDay");
      await clickButton(container, "3-day");
      await act(async () => { setViewportWidth(390); window.dispatchEvent(new Event("resize")); });
      expect(view()).toBe("timeGridThreeDay");
      await clickElement(container.querySelector(".date-strip button")!);
      expect(view()).toBe("timeGridThreeDay");
      await clickButton(container, "Admin");
      await clickButton(container, "Calendar");
      expect(view()).toBe("timeGridThreeDay");
    } finally { await cleanupRender(root, container); }
    localStorage.removeItem("shop-calendar-auth");
    const reopened = await renderAndLogin("ADMIN", 390);
    try { expect(view()).toBe("timeGridDay"); }
    finally { await cleanupRender(reopened.root, reopened.container); }
  });

  it("admin compares employees, previews/cancels, and refreshes staff and appointment colors after reassignment", async () => {
    const today = new Date();
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280, {
      users: [
        { id: "emp-1", username: "anna", displayName: "Anna", role: "EMPLOYEE", status: "ACTIVE", color: "#60a5fa" },
        { id: "emp-2", username: "ben", displayName: "Ben", role: "EMPLOYEE", status: "INACTIVE", color: "#4ade80" },
        { id: "manager-1", username: "manager", displayName: "Manager", role: "MANAGER", status: "ACTIVE", color: "#facc15" },
      ],
      appointments: [{
        id: "appt-1", employeeId: "emp-1", employeeColor: "#60a5fa",
        startAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14).toISOString(),
        endAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 15).toISOString(),
        phone: "3125550101", price: "80.00", status: "ACTIVE",
      }],
    });
    const writes = () => fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/color") && init?.method === "PATCH");
    const getCount = (path: string) => fetchMock.mock.calls.filter(
      ([url, init]) => String(url).endsWith(path) && (init?.method ?? "GET") === "GET",
    ).length;
    try {
      await clickButton(container, "Admin");
      const colors = container.querySelector(".staff-color-list")!;
      expect(colors.querySelectorAll(".staff-color-card")).toHaveLength(2);
      expect(colors.textContent).not.toMatch(/#[0-9a-f]{6}/);
      expect(colors.querySelector(".staff-color-swatch")?.getAttribute("style")).toContain("rgb(96, 165, 250)");
      expect(colors.textContent).not.toContain("Manager");
      await clickButton(container, "Reassign");
      expect(container.querySelector(".staff-color-candidate .staff-color-swatch")?.getAttribute("style")).toContain("rgb(248, 113, 113)");
      await clickButton(container, "Another color");
      expect(container.querySelector(".staff-color-candidate .staff-color-swatch")?.getAttribute("style")).toContain("rgb(244, 114, 182)");
      expect(writes()).toHaveLength(0);
      await clickButton(container, "Cancel");
      expect(container.querySelector(".staff-color-preview")).toBeNull();
      expect(writes()).toHaveLength(0);
      await clickButton(container, "Reassign");
      await clickButton(container, "Another color");
      await clickButton(container, "Another color");
      await clickButton(container, "Another color");
      expect(container.querySelector('[role="status"]')?.textContent).toContain("No more unseen");
      expect(findButtonByLabel(container, "Another color")?.disabled).toBe(true);
      const staffReadsBeforeConfirm = getCount("/users/staff");
      const appointmentReadsBeforeConfirm = getCount("/appointments");
      await clickButton(container, "Confirm use");
      expect(writes()).toHaveLength(1);
      expect(JSON.parse(String(writes()[0][1]!.body))).toEqual({ currentColor: "#60a5fa", candidateColor: "#22d3ee", previewToken: "signed-#22d3ee" });
      expect(getCount("/users/staff")).toBeGreaterThan(staffReadsBeforeConfirm);
      expect(getCount("/appointments")).toBeGreaterThan(appointmentReadsBeforeConfirm);
      expect(colors.querySelector(".staff-color-swatch")?.getAttribute("style")).toContain("rgb(34, 211, 238)");
      await clickButton(container, "Calendar");
      const event = calendarPropsSpy.mock.calls[calendarPropsSpy.mock.calls.length - 1][0].events.find((entry: any) => entry.id === "appt-1");
      expect(event.backgroundColor).toContain("#22d3ee");
      expect(event.backgroundColor).not.toContain("#60a5fa");
    } finally { await cleanupRender(root, container); }
  });

  it("filters the calendar and today's agenda by one employee, keeps repeated selection, and resets to all", async () => {
    const today = new Date();
    const makeAppointment = (id: string, employeeId: string, name: string, phone: string, hour: number) => ({
      id,
      employeeId,
      startAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour).toISOString(),
      endAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour + 1).toISOString(),
      phone,
      price: "80.00",
      customerName: name,
      note: "",
      status: "ACTIVE",
    });
    const { container, root } = await renderAndLogin("ADMIN", 1280, {
      users: [
        { id: "admin-1", username: "admin", displayName: "Admin User", role: "ADMIN", status: "ACTIVE" },
        { id: "emp-1", username: "anna", displayName: "Anna", role: "EMPLOYEE", status: "ACTIVE" },
        { id: "emp-2", username: "ben", displayName: "Ben", role: "EMPLOYEE", status: "ACTIVE" },
        { id: "pending-1", username: "pending_assignment__shop-1", displayName: "Placeholder", role: "EMPLOYEE", status: "ACTIVE" },
        { id: "inactive-1", username: "inactive", displayName: "Inactive", role: "EMPLOYEE", status: "INACTIVE" },
      ],
      appointments: [
        makeAppointment("anna-appt", "emp-1", "Anna booking", "1111111111", 10),
        makeAppointment("ben-appt", "emp-2", "Ben booking", "2222222222", 12),
        makeAppointment("pending-appt", "pending-1", "Pending booking", "3333333333", 14),
      ],
    });
    const calendarCard = Array.from(container.querySelectorAll(".dashboard-card")).find((card) =>
      card.querySelector("h2")?.textContent?.includes("Calendar"),
    );
    const legend = calendarCard?.querySelector(".legend");
    const findFilter = (label: string) => Array.from(legend?.querySelectorAll<HTMLButtonElement>(".legend-filter-button") ?? [])
      .find((button) => button.textContent?.trim() === label);
    const eventIds = () => {
      const props = calendarPropsSpy.mock.calls[calendarPropsSpy.mock.calls.length - 1][0];
      return props.events.map((event: { id: string }) => event.id);
    };
    const agendaPhones = async () => {
      await clickButton(container, "Today agenda");
      const phones = Array.from(container.querySelectorAll(".agenda-item")).map((item) => item.textContent ?? "");
      await clickButton(container, "Calendar");
      return phones;
    };
    const filterButton = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>(".legend-filter-button"))
      .find(button => button.textContent?.trim() === label);

    try {
      expect(calendarCard?.querySelector(".toolbar select")).toBeNull();
      expect(container.querySelector(".legend-filter-button")).toBeInstanceOf(HTMLButtonElement);
      expect(findFilter("All employees")?.getAttribute("aria-pressed")).toBe("true");
      expect(findFilter("Anna")?.getAttribute("aria-pressed")).toBe("false");
      expect(findFilter("Ben")?.getAttribute("aria-pressed")).toBe("false");
      expect(findFilter("pending")?.getAttribute("aria-pressed")).toBe("false");
      expect(findFilter("Inactive")).toBeUndefined();
      expect(appStylesheet).toMatch(/\.legend-filter-button:focus-visible\s*\{[^}]*outline:\s*3px/);

      const annaButton = findFilter("Anna");
      annaButton?.focus();
      expect(document.activeElement).toBe(annaButton);
      await clickButton(container, "Anna");
      expect(filterButton("Anna")?.getAttribute("aria-pressed")).toBe("true");
      expect(findFilter("All employees")?.getAttribute("aria-pressed")).toBe("false");
      expect(findFilter("Ben")?.getAttribute("aria-pressed")).toBe("false");
      expect(eventIds()).toEqual(["anna-appt"]);
      expect((await agendaPhones()).join(" ")).toContain("1111111111");
      expect((await agendaPhones()).join(" ")).not.toContain("2222222222");

      await clickButton(container, "Ben");
      expect(filterButton("Ben")?.getAttribute("aria-pressed")).toBe("true");
      expect(filterButton("Anna")?.getAttribute("aria-pressed")).toBe("false");
      expect(eventIds()).toEqual(["ben-appt"]);
      expect((await agendaPhones()).join(" ")).toContain("2222222222");
      expect((await agendaPhones()).join(" ")).not.toContain("1111111111");

      await clickButton(container, "Ben");
      expect(filterButton("Ben")?.getAttribute("aria-pressed")).toBe("true");
      expect(filterButton("All employees")?.getAttribute("aria-pressed")).toBe("false");
      expect(eventIds()).toEqual(["ben-appt"]);

      await clickButton(container, "pending");
      expect(filterButton("pending")?.getAttribute("aria-pressed")).toBe("true");
      expect(eventIds()).toEqual(["pending-appt"]);
      expect((await agendaPhones()).join(" ")).toContain("3333333333");

      await clickButton(container, "All employees");
      expect(filterButton("All employees")?.getAttribute("aria-pressed")).toBe("true");
      expect(eventIds()).toEqual(["anna-appt", "ben-appt", "pending-appt"]);
      expect(await agendaPhones()).toHaveLength(3);
    } finally {
      await cleanupRender(root, container);
    }
  });

  it("lets employee filter buttons wrap naturally on a mobile viewport", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 390);
    try {
      const legend = container.querySelector(".legend");
      expect(legend).not.toBeNull();
      expect(appStylesheet).toMatch(/\.legend\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/s);
      expect(appStylesheet).toMatch(/\.legend-filter-button\s*\{[^}]*max-width:\s*100%/s);
      expect(legend?.querySelectorAll(".legend-filter-button").length).toBeGreaterThan(1);
      expect(Array.from(legend?.querySelectorAll(".legend-filter-button") ?? []).map((button) => button.textContent?.trim()))
        .not.toContain("pending");
    } finally {
      await cleanupRender(root, container);
    }
  });

  it("renders local AM/PM start and actual end separately, without inventing a missing end", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);
    try {
      const props = calendarPropsSpy.mock.calls[calendarPropsSpy.mock.calls.length - 1][0];
      const event = props.events[0];
      expect(container.querySelector(".calendar-event-start")?.textContent).toMatch(/AM|PM/);
      expect(container.querySelector(".calendar-event-end")?.textContent).toMatch(/AM|PM/);
      const host = document.createElement("div");
      container.appendChild(host);
      const eventRoot = createRoot(host);
      try {
        await act(async () => eventRoot.render(props.eventContent({
          event: { title: event.title, start: new Date(2026, 6, 30, 0, 0),
            end: new Date(2026, 6, 30, 12, 0), extendedProps: { actualEndAt: "present" } },
          timeText: "must not use combined timeText",
        })));
        expect(host.querySelector(".calendar-event-start")?.textContent).toBe("12:00 AM");
        expect(host.querySelector(".calendar-event-end")?.textContent).toBe("12:00 PM");
        await act(async () => eventRoot.render(props.eventContent({
          event: { title: event.title, start: new Date(2026, 6, 30, 0, 0),
            end: new Date(2026, 6, 30, 1, 0), extendedProps: {} },
          timeText: "fabricated default duration",
        })));
        expect(host.querySelector(".calendar-event-end")?.textContent).toBe("");
      } finally {
        await act(async () => eventRoot.unmount());
      }
    } finally {
      await cleanupRender(root, container);
    }
  });

  it("requires acknowledgement for validation errors and preserves the draft", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);
    const phone = findControlInLabel(container, "Phone") as HTMLInputElement;
    await setControlValue(phone, "123");
    const submit = findButtonByLabel(container, "Create appointment")!;
    submit.focus();
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const dialog = container.querySelector('dialog[open]')!;
    expect(dialog).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(dialog.querySelector("button"));
    const cancel = new Event("cancel", { cancelable: true });
    await act(async () => {
      (dialog as HTMLDialogElement).close();
      await new Promise(resolve => setTimeout(resolve, 5));
    });
    expect(dialog.hasAttribute("open")).toBe(true);
    await act(async () => { dialog.dispatchEvent(cancel); });
    expect(cancel.defaultPrevented).toBe(true);
    await clickElement(dialog as HTMLElement);
    expect(container.querySelector('dialog[open]')).not.toBeNull();
    await clickButton(container, "Got it");
    expect(container.querySelector('dialog')).toBeNull();
    expect(phone.value).toBe("(123)___-____");
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(submit);
    await cleanupRender(root, container);
  });

  it("deletes the trailing phone digit and ignores a late lookup response", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    const originalFetch = fetchMock.getMockImplementation()!;
    let resolveLookup!: (response: Response) => void;
    const delayedLookup = new Promise<Response>((resolve) => {
      resolveLookup = resolve;
    });
    fetchMock.mockImplementation((input, init) => (
      String(input).includes("/customer-lookup")
        ? delayedLookup
        : originalFetch(input, init)
    ));

    try {
      const phone = findControlInLabel(container, "Phone") as HTMLInputElement;
      await setControlValue(phone, "1234567890");
      await waitFor(() => fetchMock.mock.calls.some(([input]) => String(input).includes("/customer-lookup")));
      phone.setSelectionRange(phone.value.length, phone.value.length);
      const beforeInput = new InputEvent("beforeinput", {
        inputType: "deleteContentBackward",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        phone.dispatchEvent(beforeInput);
      });

      expect(beforeInput.defaultPrevented).toBe(true);
      expect(phone.value).toBe("(123)456-789_");
      expect(phone.selectionStart).toBe(phone.value.length - 1);
      resolveLookup(new Response(JSON.stringify({
        customerName: "Stale customer",
        note: "Stale note",
      }), { status: 200 }));
      await act(async () => {
        await delayedLookup;
        await flush();
      });

      expect((findControlInLabel(container, "Customer name") as HTMLInputElement).value).toBe("");
      expect((findControlInLabel(container, "Note", "textarea") as HTMLTextAreaElement).value).toBe("");
    } finally {
      await cleanupRender(root, container);
    }
  });

  it("uses clipboard text for a phone paste when beforeinput has no data", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);

    try {
      const phone = findControlInLabel(container, "Phone") as HTMLInputElement;
      await setControlValue(phone, "1234567890");
      phone.setSelectionRange(1, 3);
      const clipboardData = {
        getData: (type: string) => (type === "text/plain" ? "98" : ""),
      };
      const pasteEvent = new Event("paste", { bubbles: true }) as ClipboardEvent;
      Object.defineProperty(pasteEvent, "clipboardData", { value: clipboardData });
      await act(async () => {
        phone.dispatchEvent(pasteEvent);
      });

      const beforeInput = new InputEvent("beforeinput", {
        inputType: "insertFromPaste",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        phone.dispatchEvent(beforeInput);
      });

      expect(beforeInput.defaultPrevented).toBe(true);
      expect(phone.value).toBe("(983)456-7890");
      expect(phone.selectionStart).toBe(3);
    } finally {
      await cleanupRender(root, container);
    }
  });

  it("reconciles noncancelable phone edits and preserves digits when only a format character is selected", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);

    try {
      const phone = findControlInLabel(container, "Phone") as HTMLInputElement;
      await setControlValue(phone, "1234567890");
      const setNativeValue = (value: string) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(phone, value);
      };

      phone.setSelectionRange(5, 5);
      const forwardDelete = new InputEvent("beforeinput", {
        inputType: "deleteContentForward",
        bubbles: true,
        cancelable: false,
      });
      await act(async () => {
        phone.dispatchEvent(forwardDelete);
        setNativeValue("(123)56-7890");
        phone.setSelectionRange(5, 5);
        phone.dispatchEvent(new InputEvent("input", {
          inputType: "deleteContentForward",
          bubbles: true,
        }));
      });
      expect(forwardDelete.defaultPrevented).toBe(false);
      expect(phone.value).toBe("(123)567-890_");
      expect(phone.selectionStart).toBe(4);
      expect(phone.selectionEnd).toBe(4);

      phone.setSelectionRange(4, 5);
      const formattingDelete = new InputEvent("beforeinput", {
        inputType: "deleteContentBackward",
        bubbles: true,
        cancelable: false,
      });
      await act(async () => {
        phone.dispatchEvent(formattingDelete);
        setNativeValue("(123567-890_");
        phone.setSelectionRange(4, 4);
        phone.dispatchEvent(new InputEvent("input", {
          inputType: "deleteContentBackward",
          bubbles: true,
        }));
      });
      expect(formattingDelete.defaultPrevented).toBe(false);
      expect(phone.value).toBe("(123)567-890_");
      expect([phone.selectionStart, phone.selectionEnd]).toEqual([4, 5]);
    } finally {
      await cleanupRender(root, container);
    }
  });

  it("queues distinct failures once, deduplicating both the visible and queued errors until acknowledgement", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    await clickButton(container, "Mock date click");
    await setControlValue(findControlInLabel(container, "Phone") as HTMLInputElement, "123");
    await clickButton(container, "Create appointment");
    expect(container.querySelector('dialog[open]')?.textContent).toContain("Phone must be exactly 10 digits");
    await clickButton(container, "Create appointment");

    await setControlValue(findControlInLabel(container, "Phone") as HTMLInputElement, "3125551234");
    await setControlValue(findControlInLabel(container, "Duration (minutes)") as HTMLInputElement, "");
    for (let attempt = 0; attempt < 2; attempt++) {
      await act(async () => {
        container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
    }
    expect(container.querySelector('dialog[open]')?.textContent).toContain("Phone must be exactly 10 digits");
    await clickButton(container, "Got it");
    await waitFor(() => container.querySelector('dialog[open]')?.textContent?.includes("Duration is required") ?? false);
    await clickButton(container, "Got it");
    expect(container.querySelector("dialog")).toBeNull();
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input).includes("/appointments") && init?.method === "POST"
    ))).toHaveLength(0);
    // Acknowledgement removes dedupe state; the same later failure must still be reported.
    await clickButton(container, "Create appointment");
    expect(container.querySelector('dialog[open]')?.textContent).toContain("Duration is required");
    await clickButton(container, "Got it");
    expect(container.querySelector("dialog")).toBeNull();
    await cleanupRender(root, container);
  });

  it("shows server save conflicts in the dialog without clearing entered values", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    await clickButton(container, "Mock event click");
    await waitFor(() => container.textContent?.includes("Update appointment") ?? false);
    const phone = findControlInLabel(container, "Phone") as HTMLInputElement;
    const originalPhone = phone.value;
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ message: "Appointment overlap" }), { status: 409 })));
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(container.querySelector('dialog[open]')?.textContent).toContain("overlaps another appointment");
    await clickButton(container, "Got it");
    expect(phone.value).toBe(originalPhone);
    expect(container.textContent).toContain("Update appointment");
    await cleanupRender(root, container);
  });

  it("keeps a 403 as an operation error, then prioritizes session expiry over the operation dialog", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    await clickButton(container, "Mock date click");
    await setControlValue(findControlInLabel(container, "Phone") as HTMLInputElement, "3125551234");
    await waitFor(() => fetchMock.mock.calls.some(([input]) => String(input).includes("/customer-lookup")));
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 })));
    await clickButton(container, "Create appointment");
    expect(container.querySelector('dialog[open]')?.textContent).toContain("Forbidden");
    expect(container.textContent).toContain("Signed in as Admin User");

    const defaultFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes("/appointments") && (init?.method ?? "GET").toUpperCase() === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 }));
      }
      if (url.endsWith("/auth/refresh")) {
        return Promise.resolve(new Response(JSON.stringify({ message: "Expired" }), { status: 401 }));
      }
      return defaultFetch(input, init);
    });
    await clickButton(container, "Create appointment");
    await waitFor(() => container.textContent?.includes("Your session is no longer valid") ?? false);
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.querySelector(".message.error")?.textContent).toContain("Your session is no longer valid");
    await cleanupRender(root, container);
  });

  it("shows failed employee creation in a dialog and preserves the entered employee draft", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    await clickButton(container, "Admin");
    const username = findControlInLabel(container, "Username") as HTMLInputElement;
    const password = findControlInLabel(container, "Password") as HTMLInputElement;
    const confirmation = findControlInLabel(container, "Confirm password") as HTMLInputElement;
    await setControlValue(username, "new-staff");
    await setControlValue(password, "password123");
    await setControlValue(confirmation, "password123");
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ message: "Username already exists" }), { status: 409 })));

    await clickButton(container, "Create user");
    expect(container.querySelector('dialog[open]')?.textContent).toContain("already exists");
    await clickButton(container, "Got it");
    expect((findControlInLabel(container, "Username") as HTMLInputElement).value).toBe("new-staff");
    expect((findControlInLabel(container, "Password") as HTMLInputElement).value).toBe("password123");
    expect(fetchMock.mock.calls.filter(([input, init]) => String(input).includes("/users") && init?.method === "POST").length).toBe(1);
    await cleanupRender(root, container);
  });

  it("reports a successful save when the following calendar refresh fails and never retries the write", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    await clickButton(container, "Mock date click");
    await clickButton(container, "45");
    await setControlValue(findControlInLabel(container, "Phone") as HTMLInputElement, "3125551234");
    await waitFor(() => fetchMock.mock.calls.some(([input]) => String(input).includes("/customer-lookup")));
    await setControlValue(findControlInLabel(container, "Price") as HTMLInputElement, "70");

    fetchMock
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ id: "created" }), { status: 201 })))
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ message: "Calendar unavailable" }), { status: 503 })));

    await clickButton(container, "Create appointment");
    await waitFor(() => container.textContent?.includes("saved successfully") ?? false);

    expect(container.querySelector("dialog")).toBeNull();
    expect(container.textContent).toContain("view could not be refreshed");
    expect((findControlInLabel(container, "Phone") as HTMLInputElement).value).toBe("");
    const appointmentWrites = () => fetchMock.mock.calls.filter(
      ([input, init]) => String(input).includes("/appointments") && init?.method === "POST",
    ).length;
    expect(appointmentWrites()).toBe(1);

    await clickButton(container, "Retry");
    await waitFor(() => !container.textContent?.includes("saved successfully"));
    expect(appointmentWrites()).toBe(1);
    await cleanupRender(root, container);
  });

  it.each([
    ["Mock event drop", 15],
    ["Mock event resize", 14],
  ] as const)("reverts failed %s but preserves its confirmed PATCH when refresh fails, retrying only reads", async (action, startHour) => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    const revert = vi.fn();
    (globalThis as any).__TEST_EVENT_REVERT__ = revert;
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ message: "Appointment overlap" }), { status: 409 })));
    const writes = () => fetchMock.mock.calls.filter(([input, init]) => (
      String(input).endsWith("/appointments/appt-1") && init?.method === "PATCH"
    ));
    const reads = () => fetchMock.mock.calls.filter(([input, init]) => (
      String(input).endsWith("/appointments") && (init?.method ?? "GET") === "GET"
    )).length;
    const readsBeforeFailure = reads();
    await clickButton(container, action);
    expect(revert).toHaveBeenCalledTimes(1);
    expect(reads()).toBe(readsBeforeFailure);
    expect(container.querySelector('dialog[open]')?.textContent).toContain("overlaps another appointment");
    await clickButton(container, "Got it");

    fetchMock
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })))
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ message: "Calendar unavailable" }), { status: 503 })));
    await clickButton(container, action);
    await waitFor(() => container.textContent?.includes("saved successfully") ?? false);
    expect(revert).toHaveBeenCalledTimes(1);
    expect(container.querySelector("dialog")).toBeNull();
    expect(writes()).toHaveLength(2);
    for (const [, init] of writes()) {
      expect(JSON.parse(String(init?.body))).toEqual({
        startAt: new Date(2026, 6, 30, startHour, 0).toISOString(),
        endAt: new Date(2026, 6, 30, 16, 0).toISOString(),
        updatedById: "admin-1",
      });
    }
    const readsBeforeRetry = reads();
    await clickButton(container, "Retry");
    await waitFor(() => !container.textContent?.includes("saved successfully"));
    expect(reads()).toBe(readsBeforeRetry + 1);
    expect(writes()).toHaveLength(2);
    expect(revert).toHaveBeenCalledTimes(1);
    await cleanupRender(root, container);
  });

  it("uses a dialog for a failed manual log refresh but inline notices for automatic loading", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    fetchMock.mockRejectedValue(new Error("Connection unavailable"));
    await clickButton(container, "Logs");
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.querySelector(".message.error")?.textContent).toContain("Connection unavailable");
    const refresh = Array.from(container.querySelectorAll("button")).find(button => /refresh/i.test(button.textContent ?? ""))!;
    await clickElement(refresh);
    expect(container.querySelector('dialog[open]')?.textContent).toContain("Connection unavailable");
    await clickButton(container, "Got it");
    await cleanupRender(root, container);
  });

  it("keeps an SSE-triggered calendar refresh error visible until that resource retries successfully", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    await waitFor(() => container.querySelectorAll(".mock-calendar-event").length > 0);
    const eventSource = [...MockEventSource.instances].reverse().find(instance => !instance.closed);
    if (!eventSource) {
      throw new Error("Active EventSource not found");
    }
    const defaultFetch = fetchMock.getMockImplementation()!;
    let failCalendarRead = true;
    fetchMock.mockImplementation((input, init) => {
      if (failCalendarRead && String(input).endsWith("/appointments") && (init?.method ?? "GET").toUpperCase() === "GET") {
        failCalendarRead = false;
        return Promise.resolve(new Response(JSON.stringify({ message: "Calendar unavailable" }), { status: 503 }));
      }
      return defaultFetch(input, init);
    });
    await act(async () => {
      expect(eventSource.emit("appointments.changed")).toBe(1);
    });
    await waitFor(() => container.textContent?.includes("Calendar unavailable") ?? false);
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.textContent).toContain("Calendar unavailable");

    await clickButton(container, "Retry");
    await waitFor(() => !container.textContent?.includes("Calendar unavailable"));
    await cleanupRender(root, container);
  });

  it("keeps phone lookup failure local and never overwrites manually edited customer fields on retry", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    const name = findControlInLabel(container, "Customer name") as HTMLInputElement;
    const note = findControlInLabel(container, "Note", "textarea") as HTMLTextAreaElement;
    await setControlValue(name, "Manual name");
    await setControlValue(note, "Manual note");
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ message: "Lookup unavailable" }), { status: 503 })));
    await setControlValue(findControlInLabel(container, "Phone") as HTMLInputElement, "3125551234");
    await waitFor(() => container.textContent?.includes("Customer lookup failed") ?? false);
    expect(container.querySelector("dialog")).toBeNull();
    expect(name.value).toBe("Manual name");
    expect(note.value).toBe("Manual note");

    await clickButton(container, "Retry");
    await waitFor(() => fetchMock.mock.calls.filter(([input]) => String(input).includes("/customer-lookup")).length >= 2);
    await flush();
    expect(name.value).toBe("Manual name");
    expect(note.value).toBe("Manual note");
    expect(container.textContent).not.toContain("Customer lookup failed");
    await cleanupRender(root, container);
  });

  it("keeps login failures inline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Invalid credentials" }), { status: 401 })));
    localStorage.clear();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(React.createElement(I18nProvider, null, React.createElement(App))); });
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.querySelector(".message.error")?.textContent).toContain("Invalid credentials");
    await cleanupRender(root, container);
  });

  it("shows the mobile primary calendar control label when using mobile width", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 800);

    const primaryControl = findButtonByLabel(container, "3-day");
    expect(primaryControl).not.toBeNull();
    expect(primaryControl?.className).not.toContain("active");
    expect(findButtonByLabel(container, "Day")?.className).toContain("active");

    await cleanupRender(root, container);
  });

  it("defaults to Day on desktop width and leaves 3-day available for manual selection", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);

    const threeDayControl = findButtonByLabel(container, "3-day");
    expect(threeDayControl).not.toBeNull();
    expect(threeDayControl?.className).not.toContain("active");
    expect(findButtonByLabel(container, "Day")?.className).toContain("active");

    await cleanupRender(root, container);
  });

  it.each(["ADMIN", "EMPLOYEE", "SHOP_ACCOUNT"] as const)("moves today's agenda to its own tab and returns %s to editing", async role => {
    const { container, root } = await renderAndLogin(role, 390);
    try {
      expect(container.querySelector(".day-agenda")).toBeNull();
      await clickButton(container, "Today agenda");
      expect(container.querySelector('[data-testid="mock-calendar"]')).toBeNull();
      expect(container.querySelectorAll(".agenda-item")).toHaveLength(2);
      await clickButton(container, "Employee");
      expect(container.querySelector(".agenda-groups")).not.toBeNull();
      await clickElement(container.querySelector(".agenda-item") as HTMLElement);
      expect(container.querySelector(".day-agenda")).toBeNull();
      expect(container.querySelector(".calendar-event-editing")).not.toBeNull();
      expect(findButtonByLabel(container, "Update appointment")).not.toBeNull();
    } finally { await cleanupRender(root, container); }
  });

  it("uses one local-date selection for overview counts, revenue, earliest and rows, independent of calendar and agenda", async () => {
    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(day); tomorrow.setDate(day.getDate() + 1);
    const yesterday = new Date(day); yesterday.setDate(day.getDate() - 1);
    const booking = (id: string, start: Date, price: string) => ({
      id, employeeId: "emp-1", startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
      phone: "3125551234", price, customerName: id, status: "ACTIVE",
    });
    const lastMinute = new Date(tomorrow.getTime() - 60_000);
    const { container, root } = await renderAndLogin("ADMIN", 1280, { appointments: [
      booking("midnight", day, "10"), booking("late", lastMinute, "20"),
      booking("tomorrow", tomorrow, "40"), booking("yesterday", yesterday, "80"),
    ] });
    try {
      await clickButton(container, "Overview");
      const rows = () => container.querySelectorAll(".appointment-item");
      const pills = () => [...container.querySelectorAll(".summary-pill strong")].map(el => el.textContent);
      expect(rows()).toHaveLength(2);
      expect(pills().slice(0, 2)).toEqual(["2", "$30.00"]);
      expect(pills()[2]).toContain("00:00");
      await clickButton(container, container.querySelector('button[aria-label="Choose overview date"]')!.textContent!);
      await setControlValue(container.querySelector('input[type="date"]') as HTMLInputElement,
        `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`);
      expect(rows()).toHaveLength(1);
      expect(rows()[0].textContent).toContain("$40");
      expect(pills().slice(0, 2)).toEqual(["1", "$40.00"]);
      expect(container.querySelector("h2")?.textContent).not.toBe("Today's overview");
      await clickButton(container, "Today agenda");
      expect(container.querySelectorAll(".agenda-item")).toHaveLength(2);
      await clickButton(container, "Overview");
      expect(rows()).toHaveLength(1);
    } finally { await cleanupRender(root, container); }
  });

  it("clears editing highlight on cancel, new draft, tab navigation and save, switches selected appointment and preserves reload", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 390);
    const selected = () => container.querySelector(".calendar-event-editing");
    try {
      await clickButton(container, "Mock event click");
      expect(container.querySelectorAll(".calendar-event-editing")).toHaveLength(1);
      expect(selected()?.textContent).toContain("Editing");
      await clickButton(container, "Calendar");
      expect(selected()).not.toBeNull();
      await clickButton(container, "Cancel");
      expect(selected()).toBeNull();
      await clickButton(container, "Mock event click");
      await clickButton(container, "Mock date click");
      expect(selected()).toBeNull();
      await clickButton(container, "Mock event click");
      await clickButton(container, "Today agenda");
      await clickButton(container, "Calendar");
      expect(selected()).toBeNull();
      await clickButton(container, "Mock event click");
      setMockEventClickId("appt-2");
      await clickButton(container, "Mock event click");
      expect(container.querySelectorAll(".calendar-event-editing")).toHaveLength(1);
      expect(selected()?.classList.contains("calendar-event-cancelled")).toBe(true);
      setMockEventClickId("appt-1");
      await clickButton(container, "Mock event click");
      const reads = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/appointments")).length;
      await act(async () => { MockEventSource.instances[MockEventSource.instances.length - 1]!.emit("appointments.changed"); });
      await waitFor(() => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/appointments")).length > reads);
      expect(selected()).not.toBeNull();
      await clickButton(container, "Update appointment");
      expect(selected()).toBeNull();
      expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes("/appointments/appt-1") && init?.method === "PATCH")).toBe(true);
    } finally { await cleanupRender(root, container); }
  });

  it("clears editing highlight when a reload removes the selected appointment", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    try {
      await clickButton(container, "Mock event click");
      const original = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation((url, init) => String(url).endsWith("/appointments") && (init?.method ?? "GET") === "GET"
        ? Promise.resolve(new Response("[]", { status: 200 })) : original(url, init));
      await act(async () => { MockEventSource.instances[MockEventSource.instances.length - 1]!.emit("appointments.changed"); });
      await waitFor(() => !!findButtonByLabel(container, "Create appointment"));
      expect(container.querySelector(".calendar-event-editing")).toBeNull();
    } finally { await cleanupRender(root, container); }
  });

  it("invalidates color preview on confirmation conflict without silently choosing or saving another color", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    try {
      await clickButton(container, "Admin");
      await clickButton(container, "Reassign");
      fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({
        message: "Staff colors changed. Preview again before confirming.",
      }), { status: 409 })));
      await clickButton(container, "Confirm use");
      expect(container.querySelector(".staff-color-preview")).toBeNull();
      expect(container.querySelector("dialog")?.textContent).toContain("Preview again");
      expect(container.querySelector(".staff-color-swatch")?.getAttribute("style")).toContain("rgb(96, 165, 250)");
    } finally { await cleanupRender(root, container); }
  });

  it("applies slot click autofill and exits editing mode back to create intent", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);

    await clickButton(container, "Mock event click");
    await waitFor(
      () => container.textContent?.includes("Update appointment") ?? false,
    );

    await clickButton(container, "Mock date click");
    await waitFor(
      () => container.textContent?.includes("Create appointment") ?? false,
    );

    const startDateInput = container.querySelector(
      'output[aria-label="Start date in MM/DD/YYYY format"]',
    ) as HTMLOutputElement | null;
    const startTimeInput = findControlInLabel(
      container,
      "Start time",
      "input",
    ) as HTMLInputElement | null;

    expect(startDateInput?.value).toBe("07/30/2026");
    expect(startTimeInput?.value).toBe("2:30");

    await cleanupRender(root, container);
  });

  it("shows admin delete styling while editing an appointment", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);

    await clickButton(container, "Mock event click");
    await waitFor(
      () => container.textContent?.includes("Update appointment") ?? false,
    );

    const deleteButton = findButtonByLabel(container, "Delete appointment");
    expect(deleteButton).not.toBeNull();
    expect(deleteButton?.className).toContain("danger-action");

    await cleanupRender(root, container);
  });

  it("renders selected appointment window in 24-hour format", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);

    await clickButton(container, "Mock event click");
    await waitFor(
      () => container.textContent?.includes("Update appointment") ?? false,
    );

    const editorText = container.querySelector(".context-card")?.textContent;
    expect(editorText).toMatch(/\b\d{2}:\d{2} - \d{2}:\d{2}\b/);
    expect(editorText).not.toContain("PM");
    expect(editorText).not.toContain("AM");

    await cleanupRender(root, container);
  });

  it("shows employee cancel behavior while editing without admin danger class", async () => {
    const { container, root } = await renderAndLogin("EMPLOYEE", 1280);

    await clickButton(container, "Mock event click");
    await waitFor(
      () => container.textContent?.includes("Update appointment") ?? false,
    );

    const cancelButton = findButtonByLabel(container, "Cancel appointment");
    expect(cancelButton).not.toBeNull();
    expect(cancelButton?.className).not.toContain("danger-action");

    await cleanupRender(root, container);
  });

  it("gives a shared shop login employee appointment controls without admin or manager tools", async () => {
    const { container, root } = await renderAndLogin("SHOP_ACCOUNT", 1280);

    await clickButton(container, "Mock event click");
    await waitFor(
      () => container.textContent?.includes("Update appointment") ?? false,
    );

    expect(findButtonByLabel(container, "Cancel appointment")).not.toBeNull();
    expect(findButtonByLabel(container, "Delete appointment")).toBeNull();
    expect(findButtonByLabel(container, "Admin")).toBeNull();
    expect(findButtonByLabel(container, "Overview")).toBeNull();
    expect(findButtonByLabel(container, "Logs")).toBeNull();
    expect(findButtonByLabel(container, "Switch shop")).toBeNull();

    await cleanupRender(root, container);
  });

  it("shows managers shop switching, overview, and logs but no admin tools", async () => {
    const { container, root } = await renderAndLogin("MANAGER", 1280, {
      activeShopId: "shop-1",
      shops: [
        { id: "shop-1", name: "Main St" },
        { id: "shop-2", name: "Second St" },
      ],
    });

    await waitFor(() => container.textContent?.includes("Switch shop (Main St)") ?? false);

    expect(findButtonByLabel(container, "Switch shop (Main St)")).not.toBeNull();
    expect(findButtonByLabel(container, "Overview")).not.toBeNull();
    expect(findButtonByLabel(container, "Admin")).toBeNull();
    expect(findButtonByLabel(container, "Logs")).not.toBeNull();
    expect(container.textContent).not.toContain("Admin tools");
    expect(container.textContent).not.toContain("Audit logs");

    await cleanupRender(root, container);
  });

  it("renders readable manager audit diffs, legacy and unknown details, with raw payloads expandable", async () => {
    const auditLogs = [
      {
        id: "log-update",
        action: "appointment.update",
        entityType: "appointment",
        entityId: "group-1",
        createdAt: "2026-07-28T15:00:00.000Z",
        actorSnapshot: {
          id: "manager-1",
          username: "manager.login",
          displayName: "Manager Name",
          role: "MANAGER",
        },
        shopSnapshot: { id: "shop-1", name: "Main St" },
        beforePayload: {
          groupId: "group-1",
          appointments: [{
            id: "appointment-1",
            employeeId: "employee-1",
            employeeDisplayName: "Alex",
            employeeColor: "#123456",
            startAt: "2026-07-28T15:00:00.000Z",
            endAt: "2026-07-28T16:00:00.000Z",
            phone: "3125550100",
            price: "70",
            status: "SCHEDULED",
            deletedAt: null,
          }],
        },
        afterPayload: {
          groupId: "group-1",
          appointments: [{
            id: "appointment-1",
            employeeId: "employee-1",
            employeeDisplayName: "Alex",
            employeeColor: "#123456",
            startAt: "2026-07-28T16:00:00.000Z",
            endAt: "2026-07-28T17:00:00.000Z",
            phone: "3125550100",
            price: "70",
            status: "SCHEDULED",
            deletedAt: null,
          }],
        },
        actor: { id: "manager-1", username: "old-login", displayName: "Old Name", role: "EMPLOYEE" },
        shop: { id: "shop-1", name: "Old Shop Name" },
      },
      {
        id: "log-legacy",
        action: "appointment.create",
        entityType: "appointment",
        entityId: "old-appointment",
        createdAt: "2026-07-27T15:00:00.000Z",
        actorSnapshot: null,
        shopSnapshot: null,
        beforePayload: null,
        afterPayload: null,
        actor: { id: "old-actor", username: "legacy", displayName: "Legacy User", role: "EMPLOYEE" },
        shop: { id: "shop-1", name: "Main St" },
      },
      {
        id: "log-unknown",
        action: "future.audit.action",
        entityType: "future-entity",
        entityId: "raw-target",
        createdAt: "2026-07-26T15:00:00.000Z",
        actorSnapshot: { displayName: "Manager Name", username: "manager.login", role: "MANAGER" },
        shopSnapshot: { id: "shop-1", name: "Main St" },
        beforePayload: { unrecognized: true },
        afterPayload: { unrecognized: "preserved" },
        actor: { id: "manager-1", username: "manager.login", displayName: "Manager Name", role: "MANAGER" },
        shop: { id: "shop-1", name: "Main St" },
      },
    ];
    const { container, root } = await renderAndLogin("MANAGER", 1280, { auditLogs });

    await clickButton(container, "Logs");
    await waitFor(() => container.textContent?.includes("Audit logs") ?? false);

    expect(container.textContent).toContain("Appointment updated");
    expect(container.textContent).toContain("Start 07/28/2026");
    expect(container.textContent).toContain("Manager Name");
    expect(container.textContent).toContain("Manager");
    expect(container.textContent).not.toContain("Old Name");
    expect(container.textContent).toContain("Older record has no change details.");
    expect(container.textContent).toContain("future.audit.action");
    expect(container.textContent).toContain("Change data is not in a recognized format");
    expect(container.querySelectorAll(".audit-raw-details")).toHaveLength(3);
    expect(
      [...container.querySelectorAll<HTMLDetailsElement>(".audit-raw-details")]
        .every((details) => !details.open),
    ).toBe(true);
    expect(container.textContent).toContain("employeeColor");

    await cleanupRender(root, container);
  });

  it("shows manager cancel and soft-delete actions while editing", async () => {
    const { container, root } = await renderAndLogin("MANAGER", 1280);

    await clickButton(container, "Mock event click");
    await waitFor(
      () => container.textContent?.includes("Update appointment") ?? false,
    );

    const cancelButton = findButtonByLabel(container, "Cancel appointment");
    expect(cancelButton).not.toBeNull();
    expect(cancelButton?.className).not.toContain("danger-action");
    expect(findButtonByLabel(container, "Delete appointment")).not.toBeNull();

    await cleanupRender(root, container);
  });

  it("allows employees to update price and reassign the edited appointment", async () => {
    const { container, root, fetchMock } = await renderAndLogin(
      "EMPLOYEE",
      1280,
    );

    await clickButton(container, "Mock event click");
    await waitFor(
      () => container.textContent?.includes("Update appointment") ?? false,
    );

    const priceInput = findControlInLabel(
      container,
      "Price",
      "input",
    ) as HTMLInputElement | null;
    const startDateInput = container.querySelector(
      'output[aria-label="Start date in MM/DD/YYYY format"]',
    ) as HTMLOutputElement | null;
    expect(priceInput).not.toBeNull();
    expect(startDateInput).not.toBeNull();
    expect(priceInput?.value).toBe("80");
    await setControlValue(priceInput as HTMLInputElement, "95");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await chooseAppointmentDate(container, tomorrow);

    await openEmployeeDropdown(container);
    const employeeUserCheckbox = findEmployeeCheckbox(
      container,
      "Employee User",
    );
    expect(employeeUserCheckbox).not.toBeNull();
    await toggleCheckbox(employeeUserCheckbox as HTMLInputElement);

    await clickButton(container, "Update appointment");
    await waitFor(() =>
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).includes("/appointments/appt-1") &&
          init?.method === "PATCH",
      ),
    );

    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).includes("/appointments/appt-1") &&
        init?.method === "PATCH",
    );
    const payload = JSON.parse(String(patchCall?.[1]?.body ?? "{}"));

    expect(payload.price).toBe("95");
    expect(payload.partySize).toBe(1);
    expect(payload.employeeIds).toEqual(["emp-logged-in"]);

    await cleanupRender(root, container);
  });

  it("saves a 45-minute appointment with a whole USD price", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    await clickButton(container, "Mock date click");
    await clickButton(container, "45");
    const durationInput = findControlInLabel(container, "Duration (minutes)") as HTMLInputElement;
    expect(durationInput.value).toBe("45");
    await setControlValue(findControlInLabel(container, "Phone") as HTMLInputElement, "3125551234");
    await setControlValue(findControlInLabel(container, "Price") as HTMLInputElement, "70");
    await clickButton(container, "Create appointment");
    await waitFor(() => fetchMock.mock.calls.some(([, init]) => init?.method === "POST" && String(init.body).includes('"price":"70"')));
    const createCall = fetchMock.mock.calls.find(([input, init]) => String(input).includes("/appointments") && init?.method === "POST");
    const payload = JSON.parse(String(createCall?.[1]?.body));
    expect(payload.price).toBe("70");
    expect(new Date(payload.endAt).getTime() - new Date(payload.startAt).getTime()).toBe(45 * 60000);
    await cleanupRender(root, container);
  });

  it.each([
    ["2", "2:00", 14, 0],
    ["10", "10:00", 10, 0],
    ["230", "2:30", 14, 30],
    ["930", "9:30", 9, 30],
    ["0930", "9:30", 9, 30],
    ["1030", "10:30", 10, 30],
  ])("does not reformat %s while typing, normalizes on blur, and submits local time", async (digits, normalized, hours, minutes) => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    await clickButton(container, "Mock date click");
    const startTimeInput = findControlInLabel(container, "Start time") as HTMLInputElement;
    expect(startTimeInput.type).toBe("text");
    expect(startTimeInput.inputMode).toBe("numeric");
    await act(async () => startTimeInput.focus());
    await setControlValue(startTimeInput, String(digits));
    expect(startTimeInput.value).toBe(digits);
    expect(startTimeInput.validity.patternMismatch).toBe(false);

    await act(async () => {
      startTimeInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(startTimeInput.value).toBe(normalized);
    expect(startTimeInput.validity.patternMismatch).toBe(false);
    expect(startTimeInput.checkValidity()).toBe(true);
    expect(startTimeInput.hasAttribute("aria-invalid")).toBe(false);

    await setControlValue(findControlInLabel(container, "Phone") as HTMLInputElement, "3125551234");
    await setControlValue(findControlInLabel(container, "Price") as HTMLInputElement, "70");
    await clickButton(container, "Create appointment");
    await waitFor(() => fetchMock.mock.calls.some(([, init]) => init?.method === "POST"));
    const createCall = fetchMock.mock.calls.find(([input, init]) => (
      String(input).includes("/appointments") && init?.method === "POST"
    ));
    const payload = JSON.parse(String(createCall?.[1]?.body ?? "{}"));
    expect(payload.startAt).toBe(new Date(2026, 6, 30, Number(hours), Number(minutes)).toISOString());
    expect(payload.endAt).toBe(new Date(2026, 6, 30, Number(hours) + 1, Number(minutes)).toISOString());
    await cleanupRender(root, container);
  });

  it("permits incomplete numeric edits without errors and clears a blur error on the next edit", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);
    await clickButton(container, "Mock date click");
    const input = findControlInLabel(container, "Start time") as HTMLInputElement;
    await act(async () => input.focus());
    expect(input.value).toBe("230");
    await setControlValue(input, "23");
    expect(input.value).toBe("23");
    expect(container.querySelector("#start-time-error")).toBeNull();
    await act(async () => input.blur());
    expect(input.value).toBe("23");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain("start-time-error");
    expect(container.querySelector('dialog[open]')).toBeNull();
    await act(async () => input.focus());
    await setControlValue(input, "230");
    expect(container.querySelector("#start-time-error")).toBeNull();
    await act(async () => input.blur());
    expect(input.value).toBe("2:30");
    await cleanupRender(root, container);
  });

  it.each([
    ["23", {}, "Enter 1–4 digits"],
    ["260", {}, "Enter 1–4 digits"],
    ["930", { calendarWindow: { slotMinTime: "08:00:00", slotMaxTime: "22:00:00" } }, "Both morning and afternoon"],
    ["930", { calendarWindow: { slotMinTime: "10:00:00", slotMaxTime: "20:00:00" } }, "Neither morning nor afternoon"],
    ["230", { calendarWindowUnavailable: true }, "cannot be safely interpreted"],
  ] as const)("shows a distinct inline blur error for %s, then save modal without writing", async (digits, options, message) => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280, options);
    // This case tests field validation, not the separate calendar-click readiness guard.
    if ("calendarWindowUnavailable" in options && options.calendarWindowUnavailable) {
      const close = container.querySelector('dialog[open] button') as HTMLButtonElement | null;
      if (close) await clickElement(close);
    }
    const input = findControlInLabel(container, "Start time") as HTMLInputElement;
    await setControlValue(findControlInLabel(container, "Start date") as HTMLInputElement, "07/30/2026");
    await setControlValue(input, digits);
    await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(input.value).toBe(digits);
    expect(container.querySelector("#start-time-error")?.textContent).toContain(message);
    expect(container.querySelector('dialog[open]')).toBeNull();
    await setControlValue(findControlInLabel(container, "Phone") as HTMLInputElement, "3125551234");
    await clickButton(container, "Create appointment");
    expect(container.querySelector('dialog[open]')?.textContent).toContain(message);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).includes("/appointments") && init?.method === "POST")).toHaveLength(0);
    await cleanupRender(root, container);
  });

  it.each(["-2", "abc230", "14:30", "12345", " 230"])("rejects paste %s without stripping or truncating, and blocks save", async (text) => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    await clickButton(container, "Mock date click");
    const input = findControlInLabel(container, "Start time") as HTMLInputElement;
    await act(async () => input.focus());
    input.setSelectionRange(0, input.value.length);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => text } });
    await act(async () => input.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(true);
    expect(input.value).toBe("230");
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3]);
    expect(container.querySelector("#start-time-error")?.textContent).toContain("Enter 1–4 digits");
    await act(async () => input.blur());
    await setControlValue(findControlInLabel(container, "Phone") as HTMLInputElement, "3125551234");
    await clickButton(container, "Create appointment");
    expect(container.querySelector('dialog[open]')?.textContent).toContain("Enter 1–4 digits");
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).includes("/appointments") && init?.method === "POST")).toHaveLength(0);
    await cleanupRender(root, container);
  });

  it("guards nonnumeric keys and excess digits while allowing selection replacement and shortcuts", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);
    await clickButton(container, "Mock date click");
    const input = findControlInLabel(container, "Start time") as HTMLInputElement;
    await act(async () => input.focus());
    await setControlValue(input, "0930");
    input.setSelectionRange(2, 2);
    for (const key of ["-", "e", ":", "5"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      await act(async () => input.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      expect(input.value).toBe("0930");
      expect(input.selectionStart).toBe(2);
    }
    input.setSelectionRange(0, 1);
    for (const [key, ctrlKey] of [["2", false], ["Backspace", false], ["Delete", false], ["ArrowLeft", false], ["a", true], ["v", true]] as const) {
      const event = new KeyboardEvent("keydown", { key, ctrlKey, bubbles: true, cancelable: true });
      await act(async () => input.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
    await setControlValue(input, "12345");
    expect(input.value).toBe("0930");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    for (const digits of ["093", "09", "0", "", "2"]) {
      await setControlValue(input, digits);
      expect(input.value).toBe(digits);
      expect(input.hasAttribute("aria-invalid")).toBe(false);
    }
    expect(input.inputMode).toBe("numeric");
    await cleanupRender(root, container);
  });

  it("moves the long explanation into a focusable tooltip with Escape, click and outside dismissal", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);
    const button = container.querySelector('button[aria-label="Start time input help"]') as HTMLButtonElement;
    const tooltip = container.querySelector("#start-time-help") as HTMLElement;
    expect(tooltip.hidden).toBe(true);
    expect(tooltip.textContent).toContain("digits only (no colon)");
    expect(container.querySelector(".start-time-field > .hint:not(.error)")).toBeNull();
    await act(async () => button.focus());
    expect(tooltip.hidden).toBe(false);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(tooltip.hidden).toBe(true);
    await clickElement(button);
    expect(tooltip.hidden).toBe(false);
    await clickElement(button);
    expect(tooltip.hidden).toBe(true);
    await clickElement(button);
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(tooltip.hidden).toBe(true);
    await act(async () => button.blur());
    const hover = new Event("pointerover", { bubbles: true });
    Object.defineProperty(hover, "pointerType", { value: "mouse" });
    await act(async () => button.dispatchEvent(hover));
    expect(tooltip.hidden).toBe(false);
    await cleanupRender(root, container);
  });

  it.each(["2", "10", "230", "0930", "1030"])("validates raw digits %s again on save without a prior blur", async (digits) => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    await clickButton(container, "Mock date click");
    const input = findControlInLabel(container, "Start time") as HTMLInputElement;
    await setControlValue(input, digits);
    await setControlValue(findControlInLabel(container, "Phone") as HTMLInputElement, "3125551234");
    await setControlValue(findControlInLabel(container, "Price") as HTMLInputElement, "70");
    expect(input.value).toBe(digits);
    await clickButton(container, "Create appointment");
    const call = fetchMock.mock.calls.find(([url, init]) => String(url).includes("/appointments") && init?.method === "POST");
    const expected = { "2": [14, 0], "10": [10, 0], "230": [14, 30], "0930": [9, 30], "1030": [10, 30] }[digits]!;
    expect(JSON.parse(String(call?.[1]?.body)).startAt).toBe(new Date(2026, 6, 30, expected[0], expected[1]).toISOString());
    await cleanupRender(root, container);
  });

  it("allows selected replacement and clearing without a time mask", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);
    await clickButton(container, "Mock date click");
    const startTimeInput = findControlInLabel(container, "Start time") as HTMLInputElement;
    await setControlValue(startTimeInput, "930");
    startTimeInput.setSelectionRange(0, startTimeInput.value.length);
    await setControlValue(startTimeInput, "2");
    expect(startTimeInput.value).toBe("2");
    await setControlValue(startTimeInput, "");
    expect(startTimeInput.value).toBe("");
    await setControlValue(startTimeInput, "9");
    expect(startTimeInput.value).toBe("9");
    expect(container.querySelector('dialog[open]')).toBeNull();
    await cleanupRender(root, container);
  });

  it("keeps calendar business-hours fields as native time inputs", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);
    await clickButton(container, "Admin");
    expect(container.textContent).toContain("Business hours");
    expect(container.textContent).toContain("The calendar also shows up to 2 hours before and after");
    expect(findControlInLabel(container, "Opening time")).not.toBeNull();
    expect(findControlInLabel(container, "Closing time")).not.toBeNull();
    const businessHourInputs = Array.from(container.querySelectorAll('input[type="time"]')) as HTMLInputElement[];
    expect(businessHourInputs).toHaveLength(2);
    expect(businessHourInputs.map((input) => input.step)).toEqual(["1800", "1800"]);
    expect(calendarPropsSpy.mock.calls.slice(-1)[0]?.[0].slotMinTime).toBe("06:00:00");
    expect(calendarPropsSpy.mock.calls.slice(-1)[0]?.[0].slotMaxTime).toBe("22:00:00");
    await cleanupRender(root, container);
  });

  it("wires seven-day real business backgrounds in both views and updates them after saving", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280, {
      calendarWindow: { slotMinTime: "10:00:00", slotMaxTime: "20:00:00" },
    });
    const props = () => calendarPropsSpy.mock.calls.slice(-1)[0][0];
    const assertHours = (start: string, end: string, min: string, max: string) => {
      expect(props().businessHours).toEqual({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: start, endTime: end });
      expect([props().slotMinTime, props().slotMaxTime]).toEqual([min, max]);
      for (const key of ["eventConstraint", "selectConstraint", "eventAllow"]) expect(props()[key]).toBeUndefined();
    };
    try {
      assertHours("10:00:00", "20:00:00", "08:00:00", "22:00:00");
      await clickButton(container, "Day");
      assertHours("10:00:00", "20:00:00", "08:00:00", "22:00:00");
      await clickButton(container, "3-day");
      assertHours("10:00:00", "20:00:00", "08:00:00", "22:00:00");
      await clickButton(container, "Admin");
      const originalFetch = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation((input, init) => {
        if (String(input).includes("/system-settings/calendar-window") && init?.method === "PATCH") {
          return Promise.resolve(new Response(String(init.body), { status: 200 }));
        }
        return originalFetch(input, init);
      });
      await setControlValue(findControlInLabel(container, "Opening time") as HTMLInputElement, "00:30");
      await setControlValue(findControlInLabel(container, "Closing time") as HTMLInputElement, "23:30");
      await clickButton(container, "Save business hours");
      await clickButton(container, "Calendar");
      assertHours("00:30:00", "23:30:00", "00:00:00", "24:00:00");
      await clickButton(container, "Day");
      assertHours("00:30:00", "23:30:00", "00:00:00", "24:00:00");
    } finally { await cleanupRender(root, container); }
  });

  it("shows business-hours labels and help in Chinese", async () => {
    localStorage.setItem("shop-calendar-locale", "zh-CN");
    const { container, root } = await renderAndLogin("ADMIN", 1280);
    await clickButton(container, "管理");
    expect(container.textContent).toContain("营业时间");
    expect(container.textContent).toContain("营业开始前和结束后最多 2 小时");
    expect(findControlInLabel(container, "营业开始时间")).not.toBeNull();
    expect(findControlInLabel(container, "营业结束时间")).not.toBeNull();
    expect(container.textContent).toContain("保存营业时间");
    await cleanupRender(root, container);
  });

  it.each([
    ["930", { slotMinTime: "08:00:00", slotMaxTime: "22:00:00" }, "Both morning and afternoon"],
    ["930", { slotMinTime: "10:00:00", slotMaxTime: "20:00:00" }, "Neither morning nor afternoon"],
    ["14:30", { slotMinTime: "08:00:00", slotMaxTime: "20:00:00" }, "Enter 1–4 digits"],
  ] as const)("rejects unresolved or non-12-hour start time %s without writing", async (time, calendarWindow, message) => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280, { calendarWindow });
    await clickButton(container, "Mock date click");
    await setControlValue(findControlInLabel(container, "Start time") as HTMLInputElement, time);
    await setControlValue(findControlInLabel(container, "Phone") as HTMLInputElement, "3125551234");
    await clickButton(container, "Create appointment");

    expect(container.querySelector('dialog[open]')?.textContent).toContain(message);
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input).includes("/appointments") && init?.method === "POST"
    ))).toHaveLength(0);
    await cleanupRender(root, container);
  });

  it("blocks new appointment submission when business hours could not be loaded", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280, { calendarWindowUnavailable: true });
    const calendarProps = calendarPropsSpy.mock.calls.slice(-1)[0]?.[0];
    const startDateInput = container.querySelector('#appointment-start-date') as HTMLOutputElement;
    const startTimeInput = findControlInLabel(container, "Start time") as HTMLInputElement;
    const priorDraft = [startDateInput.value, startTimeInput.value];
    await act(async () => calendarProps.dateClick({ date: new Date(2026, 6, 30, 14, 30) }));

    expect(container.querySelector('dialog[open]')?.textContent).toContain("cannot be safely interpreted");
    expect([startDateInput.value, startTimeInput.value]).toEqual(priorDraft);
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input).includes("/appointments") && init?.method === "POST"
    ))).toHaveLength(0);
    await cleanupRender(root, container);
  });

  it("recovers a failed business-hours load through Retry before accepting an appointment", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280, { calendarWindowUnavailable: true });
    const originalFetch = fetchMock.getMockImplementation()!;
    const recoveredWindowRead = vi.fn();
    try {
      await waitFor(() => Boolean(container.querySelector(".read-recovery-banner")));
      expect(calendarPropsSpy.mock.calls.slice(-1)[0][0].businessHours).toBe(false);
      fetchMock.mockImplementation((input, init) => {
        if (String(input).includes("/system-settings/calendar-window")) {
          recoveredWindowRead();
          return Promise.resolve(new Response(JSON.stringify({
            slotMinTime: "08:00:00",
            slotMaxTime: "20:00:00",
          }), { status: 200 }));
        }
        return originalFetch(input, init);
      });

      await clickButton(container, "Retry");
      await waitFor(() => !container.querySelector(".read-recovery-banner"));
      const appointmentStart = new Date();
      appointmentStart.setDate(appointmentStart.getDate() + 1);
      appointmentStart.setHours(14, 30, 0, 0);
      const calendarProps = calendarPropsSpy.mock.calls.slice(-1)[0]?.[0];
      expect(calendarProps.businessHours).toEqual({
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "08:00:00", endTime: "20:00:00",
      });
      await act(async () => calendarProps.dateClick({ date: appointmentStart }));
      expect(container.querySelector('dialog[open]')).toBeNull();
      expect((findControlInLabel(container, "Start time") as HTMLInputElement).value).toBe("2:30");

      await setControlValue(findControlInLabel(container, "Phone") as HTMLInputElement, "3125551234");
      await setControlValue(findControlInLabel(container, "Price") as HTMLInputElement, "70");
      await clickButton(container, "Create appointment");
      await waitFor(() => fetchMock.mock.calls.some(([input, init]) => (
        String(input).includes("/appointments") && init?.method === "POST"
      )));
      expect(recoveredWindowRead).toHaveBeenCalled();
    } finally {
      await cleanupRender(root, container);
    }
  });

  it.each([
    [20, "22:00:00"],
    [23, "24:00:00"],
  ])("blocks padded-hours clicks for closing hour %i without changing the draft, while allowing legal business-hour starts", async (closingHour, displayEnd) => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280, {
      calendarWindow: { slotMinTime: "10:00:00", slotMaxTime: `${closingHour}:00:00` },
    });
    const calendarProps = calendarPropsSpy.mock.calls.slice(-1)[0]?.[0];
    expect(calendarProps.slotMinTime).toBe("08:00:00");
    expect(calendarProps.slotMaxTime).toBe(displayEnd);
    const startDateInput = container.querySelector('#appointment-start-date') as HTMLOutputElement;
    const startTimeInput = findControlInLabel(container, "Start time") as HTMLInputElement;
    const priorDraft = [startDateInput.value, startTimeInput.value];

    await act(async () => calendarProps.dateClick({ date: new Date(2026, 6, 30, 9, 30) }));
    expect(container.querySelector('dialog[open]')?.textContent).toContain("outside business hours");
    expect([startDateInput.value, startTimeInput.value]).toEqual(priorDraft);
    let disallowedSelection = true;
    await act(async () => {
      disallowedSelection = calendarProps.selectAllow({ start: new Date(2026, 6, 30, 9, 30), end: new Date(2026, 6, 30, 10, 30) });
    });
    expect(disallowedSelection).toBe(false);
    expect(calendarProps.selectAllow({ start: new Date(2026, 6, 30, 10, 0), end: new Date(2026, 6, 30, 10, 30) })).toBe(true);
    // The existing start-only rule allows a selection to extend past closing.
    expect(calendarProps.selectAllow({ start: new Date(2026, 6, 30, closingHour - 1, 30), end: new Date(2026, 6, 30, closingHour, 30) })).toBe(true);
    expect(calendarProps.selectAllow({ start: new Date(2026, 6, 30, closingHour, 0), end: new Date(2026, 6, 30, closingHour, 30) })).toBe(false);
    await act(async () => calendarProps.dateClick({ date: new Date(2026, 6, 30, 10, 0) }));
    expect(startDateInput.value).toBe("07/30/2026");
    expect(startTimeInput.value).toBe("10:00");
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input).includes("/appointments") && init?.method === "POST"
    ))).toHaveLength(0);
    await cleanupRender(root, container);
  });

  it.each([
    { calendarWindow: { slotMinTime: "08:00:00", slotMaxTime: "20:00:00" } },
    { calendarWindow: { slotMinTime: "08:00:00", slotMaxTime: "22:00:00" } },
    { calendarWindowUnavailable: true },
  ])("preserves historical outside/ambiguous/unavailable start time through repeated focus/blur", async (options) => {
    const historicalStart = new Date(2026, 6, 30, 21, 30, 17, 123);
    const historicalEnd = new Date(historicalStart.getTime() + 60 * 60000);
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280, {
      ...options,
      appointments: [{
        id: "appt-1",
        employeeId: "emp-1",
        startAt: historicalStart.toISOString(),
        endAt: historicalEnd.toISOString(),
        phone: "3125551234",
        price: "80.00",
        status: "SCHEDULED",
      }],
    });
    await clickButton(container, "Mock event click");
    await waitFor(() => container.textContent?.includes("Update appointment") ?? false);
    const startTimeInput = findControlInLabel(container, "Start time") as HTMLInputElement;
    expect(startTimeInput.value).toBe("9:30");
    for (let i = 0; i < 3; i++) {
      await act(async () => startTimeInput.focus());
      expect(startTimeInput.value).toBe("930");
      expect(startTimeInput.inputMode).toBe("numeric");
      expect(startTimeInput.validity.patternMismatch).toBe(false);
      await act(async () => startTimeInput.blur());
      expect(startTimeInput.value).toBe("9:30");
      expect(startTimeInput.checkValidity()).toBe(true);
      expect(container.querySelector("#start-time-error")).toBeNull();
    }

    await setControlValue(findControlInLabel(container, "Note", "textarea") as HTMLTextAreaElement, "Keep historical time");
    await clickButton(container, "Update appointment");
    await waitFor(() => fetchMock.mock.calls.some(([input, init]) => (
      String(input).includes("/appointments/appt-1") && init?.method === "PATCH"
    )));
    const patchCall = fetchMock.mock.calls.find(([input, init]) => (
      String(input).includes("/appointments/appt-1") && init?.method === "PATCH"
    ));
    const payload = JSON.parse(String(patchCall?.[1]?.body ?? "{}"));
    expect(payload.startAt).toBe(historicalStart.toISOString());
    expect(payload.note).toBe("Keep historical time");
    await cleanupRender(root, container);
  });

  it.each(["70.50", "70.01"])("preserves unchanged historical price %s when editing another field", async (price) => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280, {
      appointments: [{ id: "appt-1", employeeId: "emp-1", startAt: "2026-07-30T14:00:00Z", endAt: "2026-07-30T14:45:00Z", phone: "3125551234", price, status: "SCHEDULED" }],
    });
    await clickButton(container, "Mock event click");
    await waitFor(() => container.textContent?.includes("Update appointment") ?? false);
    const priceInput = findControlInLabel(container, "Price") as HTMLInputElement;
    expect(priceInput.value).toBe(price);
    const noteInput = container.querySelector("textarea") as HTMLTextAreaElement;
    await setControlValue(noteInput, "Changed note");
    await clickButton(container, "Update appointment");
    await waitFor(() => fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"));
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    const payload = JSON.parse(String(patchCall?.[1]?.body));
    expect(payload).not.toHaveProperty("price");
    expect(payload.note).toBe("Changed note");
    await cleanupRender(root, container);
  });

  it("updates a historical fractional price to whole dollars with a 45-minute duration", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280, {
      appointments: [{ id: "appt-1", employeeId: "emp-1", startAt: "2026-07-30T14:00:00Z", endAt: "2026-07-30T15:00:00Z", phone: "3125551234", price: "70.50", status: "SCHEDULED" }],
    });
    await clickButton(container, "Mock event click");
    await waitFor(() => container.textContent?.includes("Update appointment") ?? false);
    await clickButton(container, "45");
    await setControlValue(findControlInLabel(container, "Price") as HTMLInputElement, "70");
    await clickButton(container, "Update appointment");
    await waitFor(() => fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"));
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    const payload = JSON.parse(String(patchCall?.[1]?.body));
    expect(payload.price).toBe("70");
    expect(new Date(payload.endAt).getTime() - new Date(payload.startAt).getTime()).toBe(45 * 60000);
    await cleanupRender(root, container);
  });

  it.each(["70.00", "70.50"])("rejects newly entered fractional price %s", async (price) => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);
    await clickButton(container, "Mock event click");
    await waitFor(() => container.textContent?.includes("Update appointment") ?? false);
    await setControlValue(findControlInLabel(container, "Price") as HTMLInputElement, price);
    await clickButton(container, "Update appointment");
    expect(container.textContent).toContain("Price must be a non-negative whole USD amount");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
    await cleanupRender(root, container);
  });

  it("does not include pending placeholders in all-pending group update payloads", async () => {
    const today = new Date();
    const startAt = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      14,
      0,
      0,
      0,
    );
    const endAt = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      15,
      0,
      0,
      0,
    );
    const users = [
      {
        id: "pending-id",
        username: "pending_assignment",
        displayName: "Pending",
        role: "EMPLOYEE",
        status: "ACTIVE",
      },
      {
        id: "admin-1",
        username: "admin",
        displayName: "Admin User",
        role: "ADMIN",
        status: "ACTIVE",
      },
    ];
    const appointments = ["appt-1", "appt-2", "appt-3"].map((id) => ({
      id,
      employeeId: "pending-id",
      groupId: "group-pending",
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      phone: "1234567890",
      price: "80.00",
      customerName: "Chris",
      note: "Color service",
      status: "ACTIVE",
    }));

    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280, {
      users,
      appointments,
    });

    await clickButton(container, "Mock event click");
    await waitFor(
      () => container.textContent?.includes("Update appointment") ?? false,
    );

    await clickButton(container, "Update appointment");
    await waitFor(() =>
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).includes("/appointments/appt-1") &&
          init?.method === "PATCH",
      ),
    );

    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).includes("/appointments/appt-1") &&
        init?.method === "PATCH",
    );
    const payload = JSON.parse(String(patchCall?.[1]?.body ?? "{}"));

    expect(payload.partySize).toBe(3);
    expect(payload.employeeIds).toEqual([]);

    await cleanupRender(root, container);
  });

  it("keeps cancelled appointments visible and marked in calendar, agenda, and overview", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);

    const cancelledCalendarEvent = container.querySelector(
      ".mock-calendar-event.calendar-event-cancelled",
    );
    expect(cancelledCalendarEvent).not.toBeNull();
    expect(cancelledCalendarEvent?.textContent).toContain("Morgan");
    expect(cancelledCalendarEvent?.textContent).toContain("Cancelled");

    expect(container.querySelector(".day-agenda")).toBeNull();
    await clickButton(container, "Today agenda");
    const cancelledAgendaItem = container.querySelector(
      ".agenda-item.agenda-item-cancelled",
    );
    expect(cancelledAgendaItem).not.toBeNull();
    expect(cancelledAgendaItem?.textContent).toContain("5551234567");
    expect(cancelledAgendaItem?.textContent).toContain("Cancelled");

    await clickButton(container, "Overview");

    const cancelledOverviewItem = container.querySelector(
      ".appointment-item.appointment-item-cancelled",
    );
    expect(cancelledOverviewItem).not.toBeNull();
    expect(cancelledOverviewItem?.textContent).toContain("5551234567");
    expect(cancelledOverviewItem?.textContent).toContain("Cancelled");

    await cleanupRender(root, container);
  });

  it("marks cancelled calendar events as non-editable", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);

    const activeCalendarEvent = container.querySelector(
      ".mock-calendar-event.calendar-event-assigned:not(.calendar-event-cancelled)",
    );
    const cancelledCalendarEvent = container.querySelector(
      ".mock-calendar-event.calendar-event-cancelled",
    );

    expect(activeCalendarEvent?.getAttribute("data-editable")).toBe("true");
    expect(cancelledCalendarEvent?.getAttribute("data-editable")).toBe("false");

    await cleanupRender(root, container);
  });

  it("disables update and cancel actions in the edit form for a cancelled appointment (employee)", async () => {
    const { container, root } = await renderAndLogin("EMPLOYEE", 1280);

    setMockEventClickId("appt-2");
    await clickButton(container, "Mock event click");
    await waitFor(
      () => container.textContent?.includes("Update appointment") ?? false,
    );

    const updateButton = findButtonByLabel(container, "Update appointment");
    const cancelActionButton = findButtonByLabel(container, "Cancel appointment");

    expect(updateButton).not.toBeNull();
    expect((updateButton as HTMLButtonElement)?.disabled).toBe(true);
    expect(cancelActionButton).not.toBeNull();
    expect((cancelActionButton as HTMLButtonElement)?.disabled).toBe(true);

    await cleanupRender(root, container);
  });

  it("disables update but keeps admin soft-delete enabled for a cancelled appointment", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);

    setMockEventClickId("appt-2");
    await clickButton(container, "Mock event click");
    await waitFor(
      () => container.textContent?.includes("Update appointment") ?? false,
    );

    const updateButton = findButtonByLabel(container, "Update appointment");
    const deleteButton = findButtonByLabel(container, "Delete appointment");

    expect(updateButton).not.toBeNull();
    expect((updateButton as HTMLButtonElement)?.disabled).toBe(true);
    expect(deleteButton).not.toBeNull();
    expect((deleteButton as HTMLButtonElement)?.disabled).toBe(false);

    await cleanupRender(root, container);
  });

  it("autofills start date and time when switching mobile 3-day to Day before slot click", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 800);
    await clickButton(container, "3-day");

    const threeDayButton = findButtonByLabel(container, "3-day");
    expect(threeDayButton).not.toBeNull();
    expect(threeDayButton?.className).toContain("active");

    await clickButton(container, "Day");
    const dayButton = findButtonByLabel(container, "Day");
    expect(dayButton?.className).toContain("active");

    await clickButton(container, "Mock date click");

    const startDateInput = container.querySelector(
      'output[aria-label="Start date in MM/DD/YYYY format"]',
    ) as HTMLOutputElement | null;
    const startTimeInput = findControlInLabel(
      container,
      "Start time",
      "input",
    ) as HTMLInputElement | null;

    await waitFor(() => (startTimeInput?.value ?? "") === "2:30");
    expect(startDateInput?.value).toBe("07/30/2026");
    expect(startTimeInput?.value).toBe("2:30");

    await cleanupRender(root, container);
  });

  it("keeps mobile 3-day primary control available and active after Prev and Next navigation", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 800);
    await clickButton(container, "3-day");

    const initialPrimaryControl = findButtonByLabel(container, "3-day");
    expect(initialPrimaryControl).not.toBeNull();
    expect(initialPrimaryControl?.className).toContain("active");

    await clickButton(container, "Prev");
    const afterPrevPrimaryControl = findButtonByLabel(container, "3-day");
    expect(afterPrevPrimaryControl).not.toBeNull();
    expect(afterPrevPrimaryControl?.className).toContain("active");

    await clickButton(container, "Next");
    const afterNextPrimaryControl = findButtonByLabel(container, "3-day");
    expect(afterNextPrimaryControl).not.toBeNull();
    expect(afterNextPrimaryControl?.className).toContain("active");

    await cleanupRender(root, container);
  });

  it("shows mobile fixed note layer for truncated note content", async () => {
    const longNote =
      "Long mobile note details to verify fixed layer rendering and full content visibility.";
    setMockCalendarNoteState(true, longNote);
    setMobilePointerMode(true);
    const { container, root } = await renderAndLogin("ADMIN", 800);

    const noteElement = container.querySelector(
      ".calendar-event-note",
    ) as HTMLElement | null;
    expect(noteElement).not.toBeNull();

    await clickElement(noteElement as HTMLElement);

    await waitFor(
      () => document.querySelector(".calendar-note-tooltip-layer") !== null,
    );
    const tooltipContent = document.querySelector(
      ".calendar-note-tooltip-content",
    );
    expect(tooltipContent?.textContent).toContain(longNote);

    await cleanupRender(root, container);
  });

  it("closes mobile fixed note layer when clicking blank backdrop area", async () => {
    setMockCalendarNoteState(true, "Backdrop close test note");
    setMobilePointerMode(true);
    const { container, root } = await renderAndLogin("ADMIN", 800);

    const noteElement = container.querySelector(
      ".calendar-event-note",
    ) as HTMLElement | null;
    expect(noteElement).not.toBeNull();
    await clickElement(noteElement as HTMLElement);
    await waitFor(
      () => document.querySelector(".calendar-note-tooltip-layer") !== null,
    );

    const backdrop = document.querySelector(
      ".calendar-note-tooltip-backdrop",
    ) as HTMLElement | null;
    expect(backdrop).not.toBeNull();
    await clickElement(backdrop as HTMLElement);
    await waitFor(
      () => document.querySelector(".calendar-note-tooltip-layer") === null,
    );

    await cleanupRender(root, container);
  });

  it("closes mobile fixed note layer when clicking close button", async () => {
    setMockCalendarNoteState(true, "Button close test note");
    setMobilePointerMode(true);
    const { container, root } = await renderAndLogin("ADMIN", 800);

    const noteElement = container.querySelector(
      ".calendar-event-note",
    ) as HTMLElement | null;
    expect(noteElement).not.toBeNull();
    await clickElement(noteElement as HTMLElement);
    await waitFor(
      () => document.querySelector(".calendar-note-tooltip-layer") !== null,
    );

    const closeButton = document.querySelector(
      ".calendar-note-tooltip-close",
    ) as HTMLElement | null;
    expect(closeButton).not.toBeNull();
    await clickElement(closeButton as HTMLElement);
    await waitFor(
      () => document.querySelector(".calendar-note-tooltip-layer") === null,
    );

    await cleanupRender(root, container);
  });

  it("does not show mobile fixed note layer when note is not truncated", async () => {
    setMockCalendarNoteState(false, "Short note");
    setMobilePointerMode(true);
    const { container, root } = await renderAndLogin("ADMIN", 800);

    const noteElement = container.querySelector(
      ".calendar-event-note",
    ) as HTMLElement | null;
    expect(noteElement).not.toBeNull();
    await clickElement(noteElement as HTMLElement);

    await flush();
    expect(document.querySelector(".calendar-note-tooltip-layer")).toBeNull();

    await cleanupRender(root, container);
  });

  it("preserves non-time fields when clicking a slot while already in create mode", async () => {
    const { container, root } = await renderAndLogin("ADMIN", 1280);

    const durationInput = findControlInLabel(
      container,
      "Duration (minutes)",
      "input",
    ) as HTMLInputElement | null;
    const phoneInput = findControlInLabel(
      container,
      "Phone",
      "input",
    ) as HTMLInputElement | null;
    const priceInput = findControlInLabel(
      container,
      "Price",
      "input",
    ) as HTMLInputElement | null;
    const customerInput = findControlInLabel(
      container,
      "Customer name",
      "input",
    ) as HTMLInputElement | null;
    const noteInput = findControlInLabel(
      container,
      "Note",
      "textarea",
    ) as HTMLTextAreaElement | null;

    expect(durationInput).not.toBeNull();
    expect(phoneInput).not.toBeNull();
    expect(priceInput).not.toBeNull();
    expect(customerInput).not.toBeNull();
    expect(noteInput).not.toBeNull();

    await clickButton(container, "90");
    await waitFor(() => (durationInput as HTMLInputElement).value === "90");
    await setControlValue(phoneInput as HTMLInputElement, "5551234567");
    await setControlValue(priceInput as HTMLInputElement, "125.5");
    await setControlValue(customerInput as HTMLInputElement, "Taylor");
    await setControlValue(
      noteInput as HTMLTextAreaElement,
      "Please call on arrival",
    );

    await clickButton(container, "Mock date click");

    const startDateInput = container.querySelector(
      'output[aria-label="Start date in MM/DD/YYYY format"]',
    ) as HTMLOutputElement | null;
    const startTimeInput = findControlInLabel(
      container,
      "Start time",
      "input",
    ) as HTMLInputElement | null;

    await waitFor(() => (startTimeInput?.value ?? "") === "2:30");

    expect(startDateInput?.value).toBe("07/30/2026");
    expect(startTimeInput?.value).toBe("2:30");
    expect((durationInput as HTMLInputElement).value).toBe("90");
    expect((phoneInput as HTMLInputElement).value).toBe("(555)123-4567");
    expect((priceInput as HTMLInputElement).value).toBe("125.5");
    expect((customerInput as HTMLInputElement).value).toBe("Taylor");
    expect((noteInput as HTMLTextAreaElement).value).toBe(
      "Please call on arrival",
    );
    expect(container.textContent?.includes("Create appointment")).toBe(true);

    await cleanupRender(root, container);
  });

  it("keeps display name read-only and synced to username in admin create user form", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);

    await clickButton(container, "Admin");

    const usernameInput = findControlInLabel(
      container,
      "Username",
      "input",
    ) as HTMLInputElement | null;
    const displayNameInput = findControlInLabel(
      container,
      "Display name",
      "input",
    ) as HTMLInputElement | null;
    const passwordInput = findControlInLabel(
      container,
      "Password",
      "input",
    ) as HTMLInputElement | null;
    const confirmPasswordInput = findControlInLabel(
      container,
      "Confirm password",
      "input",
    ) as HTMLInputElement | null;

    expect(usernameInput).not.toBeNull();
    expect(displayNameInput).not.toBeNull();
    expect(passwordInput).not.toBeNull();
    expect(confirmPasswordInput).not.toBeNull();

    await setControlValue(usernameInput as HTMLInputElement, "new.employee");
    expect((displayNameInput as HTMLInputElement).readOnly).toBe(true);
    expect((displayNameInput as HTMLInputElement).value).toBe("new.employee");

    await setControlValue(passwordInput as HTMLInputElement, "secret123");
    await setControlValue(
      confirmPasswordInput as HTMLInputElement,
      "secret123",
    );
    await clickButton(container, "Create user");

    const createUserCall = fetchMock.mock.calls.find((call) => {
      const url = String(call[0]);
      const method = (
        (call[1] as RequestInit | undefined)?.method ?? "GET"
      ).toUpperCase();
      return url.includes("/users") && method === "POST";
    });

    expect(createUserCall).toBeDefined();

    const payload = JSON.parse(
      String((createUserCall?.[1] as RequestInit | undefined)?.body ?? "{}"),
    ) as {
      username?: string;
      displayName?: string;
      role?: string;
    };
    expect(payload.username).toBe("new.employee");
    expect(payload.displayName).toBe("new.employee");
    expect(payload.role).toBe("EMPLOYEE");

    const roleSelect = findControlInLabel(
      container,
      "Role",
      "select",
    ) as HTMLSelectElement | null;
    expect(roleSelect).not.toBeNull();
    expect(Array.from(roleSelect?.options ?? []).map((option) => option.value)).toEqual([
      "EMPLOYEE",
      "MANAGER",
      "SHOP_ACCOUNT",
    ]);

    await cleanupRender(root, container);
  });

  it("separates shared managers in management and reset options without changing creation or service options", async () => {
    const users = [
      {
        id: "admin-1",
        username: "admin",
        displayName: "Admin",
        role: "ADMIN",
        status: "ACTIVE",
      },
      {
        id: "emp-1",
        username: "anna",
        displayName: "Anna",
        role: "EMPLOYEE",
        status: "ACTIVE",
      },
      {
        id: "shared",
        username: "shop",
        displayName: "Shared",
        role: "SHOP_ACCOUNT",
        status: "ACTIVE",
      },
      {
        id: "manager-a",
        username: "alex",
        displayName: "Alex",
        role: "MANAGER",
        status: "ACTIVE",
      },
      {
        id: "manager-inactive",
        username: "inactive",
        displayName: "Inactive manager",
        role: "MANAGER",
        status: "INACTIVE",
      },
      {
        id: "pending",
        username: "pending_assignment__shop-1",
        displayName: "Pending",
        role: "EMPLOYEE",
        status: "ACTIVE",
      },
    ];
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280, {
      users,
    });
    await clickButton(container, "Admin");
    const group = container.querySelector(
      '[role="group"][aria-label="Managers (all shops)"]',
    );
    expect(group?.querySelectorAll(".user-item")).toHaveLength(2);
    expect(group?.textContent).toContain("apply to all shops");
    expect(
      Array.from(container.querySelectorAll(".user-item strong")).map(
        (node) => node.textContent,
      ),
    ).toEqual(["Anna", "Shared", "Alex", "Inactive manager"]);
    const target = container.querySelector(
      'select[name="targetUserId"]',
    ) as HTMLSelectElement;
    expect(
      Array.from(target.querySelectorAll("optgroup option")).map(
        (option) => (option as HTMLOptionElement).value,
      ),
    ).toEqual(["manager-a", "manager-inactive"]);
    expect(
      Array.from(target.options).filter((option) => option.value === "manager-a"),
    ).toHaveLength(1);
    expect(
      Array.from(target.options).some((option) => option.value === "pending"),
    ).toBe(false);
    expect(
      Array.from(target.options).some((option) => option.value === "admin-1"),
    ).toBe(true);
    const roleSelect = container.querySelector(
      'select[name="role"]',
    ) as HTMLSelectElement;
    expect(Array.from(roleSelect.options).map((option) => option.value)).toEqual([
      "EMPLOYEE",
      "MANAGER",
      "SHOP_ACCOUNT",
    ]);
    await setControlValue(target, "manager-a");
    const resetForm = target.closest("form")!;
    await setControlValue(
      resetForm.querySelector('[name="newPassword"]') as HTMLInputElement,
      "new-password",
    );
    await setControlValue(
      resetForm.querySelector('[name="confirmPassword"]') as HTMLInputElement,
      "new-password",
    );
    await act(async () => {
      resetForm.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await flush();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/users/manager-a/password") &&
          init?.method === "PATCH",
      ),
    ).toBe(true);
    const enable = Array.from(group?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Enable",
    )!;
    await act(async () => {
      enable.click();
    });
    await flush();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/users/manager-inactive/status") &&
          init?.method === "PATCH",
      ),
    ).toBe(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const remove = Array.from(group?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Remove",
    )!;
    await act(async () => {
      remove.click();
    });
    await flush();
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("apply to all shops"),
    );
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/users/manager-a") && init?.method === "DELETE",
      ),
    ).toBe(true);
    confirm.mockRestore();
    await cleanupRender(root, container);
  });

  it("lets admins choose a manager when creating a user", async () => {
    const { container, root, fetchMock } = await renderAndLogin("ADMIN", 1280);

    await clickButton(container, "Admin");

    await setControlValue(findControlInLabel(container, "Username", "input") as HTMLInputElement, "manager.employee");
    await setControlValue(findControlInLabel(container, "Password", "input") as HTMLInputElement, "secret123");
    await setControlValue(findControlInLabel(container, "Confirm password", "input") as HTMLInputElement, "secret123");
    await setControlValue(findControlInLabel(container, "Role", "select") as HTMLSelectElement, "MANAGER");
    await clickButton(container, "Create user");

    const createUserCall = fetchMock.mock.calls.find((call) => {
      const url = String(call[0]);
      const method = ((call[1] as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      return url.includes("/users") && method === "POST";
    });
    const payload = JSON.parse(String((createUserCall?.[1] as RequestInit | undefined)?.body ?? "{}"));

    expect(payload.role).toBe("MANAGER");

    await cleanupRender(root, container);
  });
});

const makeEmployeeSelectionFetchMock = () => {
  const auth = {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenType: "Bearer",
    user: {
      id: "admin-1",
      username: "admin",
      displayName: "Admin User",
      role: "ADMIN",
      status: "ACTIVE",
    },
  };

  const users = [
    {
      id: "admin-1",
      username: "admin",
      displayName: "Admin User",
      role: "ADMIN",
      status: "ACTIVE",
    },
    {
      id: "emp-1",
      username: "anna",
      displayName: "Anna",
      role: "EMPLOYEE",
      status: "ACTIVE",
    },
    {
      id: "emp-2",
      username: "ben",
      displayName: "Ben",
      role: "EMPLOYEE",
      status: "ACTIVE",
    },
    {
      id: "emp-3",
      username: "cara",
      displayName: "Cara",
      role: "EMPLOYEE",
      status: "ACTIVE",
    },
  ];

  const ok = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.endsWith("/auth/login") && method === "POST") {
      return ok(auth);
    }

    if (url.includes("/users") && method === "GET") {
      return ok(users.map((user, index) => ({
        ...user,
        color: ['#60a5fa', '#4ade80', '#f472b6', '#facc15'][index % 4],
      })));
    }

    if (url.includes("/appointments") && method === "GET") {
      return ok([]);
    }

    if (url.includes("/system-settings/calendar-window") && method === "GET") {
      return ok({ slotMinTime: "08:00:00", slotMaxTime: "20:00:00" });
    }

    return ok({});
  });
};

const renderAndLoginForEmployeeSelection = async () => {
  setViewportWidth(1280);
  (globalThis as any).EventSource = MockEventSource;
  const fetchMock = makeEmployeeSelectionFetchMock();
  vi.stubGlobal("fetch", fetchMock);

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(I18nProvider, null, React.createElement(App)),
    );
  });

  const loginForm = container.querySelector("form");
  if (!loginForm) {
    throw new Error("Login form not found");
  }

  const loginInputs = Array.from(
    loginForm.querySelectorAll("input"),
  ) as HTMLInputElement[];
  await setControlValue(loginInputs[0], "admin");
  await setControlValue(loginInputs[1], "admin123");

  await act(async () => {
    loginForm.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });

  await waitFor(() => container.textContent?.includes("Signed in as") ?? false);
  await flush();

  return { container, root };
};

const openEmployeeDropdown = async (container: HTMLElement) => {
  const toggle = container.querySelector(
    ".employee-dropdown-toggle",
  ) as HTMLButtonElement | null;
  if (!toggle) {
    throw new Error("Employee dropdown toggle not found");
  }
  await clickElement(toggle);
};

const findEmployeeCheckbox = (container: HTMLElement, displayName: string) => {
  const options = Array.from(
    container.querySelectorAll(".employee-dropdown-panel .checkbox-option"),
  );
  const match = options.find(
    (option) => option.textContent?.trim() === displayName,
  );
  return (match?.querySelector('input[type="checkbox"]') ??
    null) as HTMLInputElement | null;
};

const toggleCheckbox = async (checkbox: HTMLInputElement) => {
  await act(async () => {
    checkbox.click();
  });
};

describe("App employee selection checkbox behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = "";
    setMockCalendarNoteState(false);
    setMobilePointerMode(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a single spinner-free number input and original change/blur bounds and employee trimming", async () => {
    localStorage.setItem("shop-calendar-locale", "en");
    const { container, root } = await renderAndLoginForEmployeeSelection();
    try {
      const input = findControlInLabel(container, "Party size") as HTMLInputElement;
      expect(container.querySelector(".party-size-control button")).toBeNull();
      expect(input.type).toBe("number");
      expect(input.inputMode).toBe("numeric");
      expect(input.hasAttribute("pattern")).toBe(false);
      expect([input.min, input.max]).toEqual(["1", "99"]);
      expect(appStylesheet).toMatch(/\.party-size-control input\s*\{[^}]*appearance: textfield/s);
      expect(appStylesheet).toMatch(/\.party-size-control input::-webkit-inner-spin-button,\s*\.party-size-control input::-webkit-outer-spin-button\s*\{[^}]*-webkit-appearance: none/s);
      expect(appStylesheet).not.toMatch(/(?:^|\n)input(?:::\-webkit-(?:inner|outer)-spin-button|\[type=["']?number)/);
      await setControlValue(input, "3");
      expect(input.value).toBe("3");
      expect(container.querySelector("#employee-help")?.textContent).toContain('3 "pending"');
      await openEmployeeDropdown(container);
      await toggleCheckbox(findEmployeeCheckbox(container, "Anna")!);
      await toggleCheckbox(findEmployeeCheckbox(container, "Ben")!);
      expect(container.querySelector("#employee-help")?.textContent).toContain('1 "pending"');
      await setControlValue(input, "1");
      // onChange alone does not trim; original blur rule does.
      expect(findEmployeeCheckbox(container, "Ben")!.checked).toBe(true);
      await act(async () => { input.focus(); input.blur(); });
      expect(findEmployeeCheckbox(container, "Anna")!.checked).toBe(true);
      expect(findEmployeeCheckbox(container, "Ben")!.checked).toBe(false);
      expect(container.querySelector("#employee-help")?.textContent).toBe("All headcount is assigned to employees.");
      for (const [raw, expected] of [["0", "1"], ["100", "99"], ["", "1"]]) {
        await setControlValue(input, raw);
        expect(input.value).toBe(raw);
        await act(async () => { input.focus(); input.blur(); });
        expect(input.value).toBe(expected);
      }
    } finally { await cleanupRender(root, container); }
  });

  it("replaces the previously checked employee instead of adjusting party size when party size is 1", async () => {
    const { container, root } = await renderAndLoginForEmployeeSelection();

    const partySizeInput = findControlInLabel(
      container,
      "Party size",
      "input",
    ) as HTMLInputElement | null;
    expect(partySizeInput?.value).toBe("1");

    await openEmployeeDropdown(container);
    const annaCheckbox = findEmployeeCheckbox(container, "Anna");
    const benCheckbox = findEmployeeCheckbox(container, "Ben");
    expect(annaCheckbox).not.toBeNull();
    expect(benCheckbox).not.toBeNull();

    await toggleCheckbox(annaCheckbox as HTMLInputElement);
    expect((annaCheckbox as HTMLInputElement).checked).toBe(true);

    await toggleCheckbox(benCheckbox as HTMLInputElement);

    expect((benCheckbox as HTMLInputElement).checked).toBe(true);
    expect((annaCheckbox as HTMLInputElement).checked).toBe(false);
    expect((partySizeInput as HTMLInputElement).value).toBe("1");

    await cleanupRender(root, container);
  });

  it("blocks checking an extra employee and shows a notice once selected count reaches party size", async () => {
    const { container, root } = await renderAndLoginForEmployeeSelection();

    const partySizeInput = findControlInLabel(
      container,
      "Party size",
      "input",
    ) as HTMLInputElement | null;
    expect(partySizeInput).not.toBeNull();
    await setControlValue(partySizeInput as HTMLInputElement, "2");

    await openEmployeeDropdown(container);
    const annaCheckbox = findEmployeeCheckbox(container, "Anna");
    const benCheckbox = findEmployeeCheckbox(container, "Ben");
    const caraCheckbox = findEmployeeCheckbox(container, "Cara");
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
    expect((partySizeInput as HTMLInputElement).value).toBe("2");

    const notice = container.querySelector('[role="alertdialog"]');
    expect(notice?.textContent).toContain("reached the party size");

    await cleanupRender(root, container);
  });
});
