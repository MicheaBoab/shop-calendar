import { describe, expect, it } from "vitest";
import { getAuditPresentation } from "./audit-presentation";

const formatDate = (value: string) => `local:${value}`;
const missing = "legacy missing";
const noChanges = "no changes";

const appointment = (overrides: Record<string, unknown> = {}) => ({
  id: "appointment-1",
  employeeId: "staff-1",
  employeeDisplayName: "Alex",
  employeeColor: "#123456",
  startAt: "2026-11-02T18:00:00.000Z",
  endAt: "2026-11-02T19:00:00.000Z",
  phone: "3125550100",
  price: "70",
  customerName: "Customer",
  serviceName: "Cut",
  status: "SCHEDULED",
  note: null,
  deletedAt: null,
  ...overrides,
});

describe("audit presentation", () => {
  it.each(["en", "zh-CN"] as const)("shows employee color before/after in %s", (locale) => {
    const user = { username: "anna", displayName: "Anna", role: "EMPLOYEE", status: "ACTIVE" };
    const result = getAuditPresentation(
      { ...user, color: "#60a5fa" }, { ...user, color: "#f87171" },
      "user", locale, formatDate, missing, noChanges,
    );
    expect(result.changes).toEqual([{
      field: locale === "en" ? "Color" : "颜色", before: "#60a5fa", after: "#f87171",
    }]);
  });
  it.each(["en", "zh-CN"] as const)(
    "shows global manager scope and home/execution shops in %s",
    (locale) => {
      const payload = {
        username: "manager",
        role: "MANAGER",
        status: "ACTIVE",
        managementScope: "global",
        homeShopId: "shop-a",
        operationShopId: "shop-b",
      };
      const result = getAuditPresentation(
        payload,
        payload,
        "user",
        locale,
        formatDate,
        missing,
        noChanges,
      );
      expect(result.summary[0]).toContain("shop-a");
      expect(result.summary[0]).toContain("shop-b");
      expect(result.summary[0]).toContain(
        locale === "en" ? "all shops" : "全店生效",
      );
    },
  );

  it("summarizes created appointments with readable service data", () => {
    const result = getAuditPresentation(
      null,
      { groupId: "group-1", appointments: [appointment()] },
      "appointment",
      "en",
      formatDate,
      missing,
      noChanges,
    );

    expect(result.created).toBe(true);
    expect(result.summary).toContain("Service staff: Alex");
    expect(result.summary).toContain("Phone: 3125550100");
    expect(result.summary).toContain("Price: 70");
    expect(result.summary.some((line) => line.includes("local:"))).toBe(true);
  });

  it("shows group membership and party-size differences by names", () => {
    const result = getAuditPresentation(
      { groupId: "g", appointments: [appointment()] },
      {
        groupId: "g",
        appointments: [
          appointment(),
          appointment({
            id: "appointment-2",
            employeeId: "staff-2",
            employeeDisplayName: "Sam",
          }),
        ],
      },
      "appointment",
      "zh-CN",
      formatDate,
      missing,
      noChanges,
    );

    expect(result.summary.some((line) => line.startsWith("服务员工:"))).toBe(
      false,
    );
    expect(result.summary).toContain("新增服务员工: Sam");
    expect(result.summary).toContain("人数: 1 → 2");
  });

  it("names removed group members instead of showing only an opaque count", () => {
    const result = getAuditPresentation(
      {
        groupId: "g",
        appointments: [
          appointment(),
          appointment({
            id: "appointment-2",
            employeeId: "staff-2",
            employeeDisplayName: "Sam",
          }),
        ],
      },
      { groupId: "g", appointments: [appointment()] },
      "appointment",
      "en",
      formatDate,
      missing,
      noChanges,
    );

    expect(result.summary).toContain("Removed staff: Sam");
    expect(result.summary).toContain("Party size: 2 → 1");
  });

  it("reports cancel and soft-delete state transitions", () => {
    const before = { groupId: "g", appointments: [appointment()] };
    const cancelled = getAuditPresentation(
      before,
      { groupId: "g", appointments: [appointment({ status: "CANCELLED" })] },
      "appointment",
      "en",
      formatDate,
      missing,
      noChanges,
    );
    const deleted = getAuditPresentation(
      before,
      {
        groupId: "g",
        appointments: [
          appointment({
            status: "CANCELLED",
            deletedAt: "2026-11-02T17:00:00Z",
          }),
        ],
      },
      "appointment",
      "en",
      formatDate,
      missing,
      noChanges,
    );

    expect(cancelled.summary).toContain("Status: Scheduled → Cancelled");
    expect(deleted.summary).toContain(
      "Calendar visibility: visible → 1 hidden",
    );
  });

  it("does not invent details for old records and tolerates malformed/unknown payloads", () => {
    expect(
      getAuditPresentation(
        null,
        null,
        "future.action",
        "en",
        formatDate,
        missing,
        noChanges,
      ),
    ).toMatchObject({
      legacyMissing: true,
      unrecognizedPayload: false,
      summary: [missing],
    });
    expect(
      getAuditPresentation(
        [],
        { unexpected: { nested: true } },
        "unknown",
        "en",
        formatDate,
        missing,
        noChanges,
      ),
    ).toMatchObject({
      legacyMissing: false,
      unrecognizedPayload: true,
      summary: [missing],
    });
  });

  const present = (before: unknown, after: unknown) =>
    getAuditPresentation(
      before,
      after,
      "appointment",
      "en",
      formatDate,
      missing,
      noChanges,
    );

  const group = (...appointments: Record<string, unknown>[]) => ({
    groupId: "g",
    appointments,
  });
  const sam = (overrides: Record<string, unknown> = {}) =>
    appointment({
      id: "appointment-2",
      employeeId: "staff-2",
      employeeDisplayName: "Sam",
      price: "80",
      ...overrides,
    });

  it("reports a non-first price change by appointment ID without an aggregate false positive", () => {
    expect(
      present(
        group(appointment(), sam()),
        group(appointment(), sam({ price: "70" })),
      ).changes,
    ).toEqual([
      { field: "Price · Sam (appointment-2)", before: "80", after: "70" },
    ]);
  });

  it("ignores member reordering even with heterogeneous business fields", () => {
    const a = appointment();
    const b = sam({ note: "different", status: "CANCELLED" });
    expect(present(group(a, b), group(b, a)).changes).toEqual([]);
  });

  it("combines a genuinely shared change only once and canonicalizes legacy prices", () => {
    expect(
      present(
        group(appointment(), sam({ price: 70 })),
        group(appointment({ price: "80.50" }), sam({ price: 80.5 })),
      ).changes,
    ).toEqual([{ field: "Price", before: "70", after: "80.50" }]);
    expect(
      present(appointment({ price: 70.5 }), appointment({ price: "70.50" }))
        .changes,
    ).toEqual([]);
  });

  it("does not lose non-first time, note or status edits", () => {
    const endAt = "2026-11-02T19:30:00.000Z";
    expect(
      present(
        group(appointment(), sam()),
        group(appointment(), sam({ endAt, note: "new", status: "CANCELLED" })),
      ).changes,
    ).toEqual([
      {
        field: "End · Sam (appointment-2)",
        before: "local:2026-11-02T19:00:00.000Z",
        after: `local:${endAt}`,
      },
      { field: "Note · Sam (appointment-2)", before: "—", after: "new" },
      {
        field: "Status · Sam (appointment-2)",
        before: "Scheduled",
        after: "Cancelled",
      },
    ]);
  });

  it("keeps price edits and added/removed member identity differences together", () => {
    expect(
      present(
        group(appointment(), sam()),
        group(
          appointment({ price: "60" }),
          sam({
            id: "appointment-3",
            employeeId: "staff-3",
            employeeDisplayName: "Jo",
          }),
        ),
      ).changes,
    ).toEqual([
      { field: "Price · Alex (appointment-1)", before: "70", after: "60" },
      { field: "Added staff", before: "", after: "Jo" },
      { field: "Removed staff", before: "", after: "Sam" },
    ]);
  });

  it("does not pair legacy rows without appointment IDs or expose metadata diffs", () => {
    const a = appointment({ id: undefined });
    const b = sam({ id: undefined });
    expect(present(group(a, b), group(b, a)).changes).toEqual([]);
    expect(
      present(group(a, b), group(a, sam({ id: undefined, price: "60" })))
        .changes,
    ).toEqual([{ field: "Price", before: "70, 80", after: "60, 70" }]);
    expect(
      present(
        group(appointment()),
        group(appointment({ createdAt: "changed", updatedAt: "changed" })),
      ).changes,
    ).toEqual([]);
  });

  it("shows same-name replacement by ID in single and grouped snapshots", () => {
    const before = appointment({ employeeId: "staff-A" });
    const after = appointment({ employeeId: "staff-B" });
    expect(present(before, after).changes).toContainEqual({
      field: "Service staff",
      before: "Alex (staff-A)",
      after: "Alex (staff-B)",
    });
    const group = present(
      { appointments: [before] },
      { appointments: [after] },
    );
    expect(group.changes).toEqual([
      { field: "Added staff", before: "", after: "Alex (staff-B)" },
      { field: "Removed staff", before: "", after: "Alex (staff-A)" },
    ]);
  });

  it("compares canonical ID sets regardless of order and reports rename without replacement", () => {
    const a = appointment();
    const b = appointment({
      employeeId: "staff-2",
      employeeDisplayName: "Sam",
    });
    expect(
      present({ appointments: [a, b] }, { appointments: [b, a] }).summary,
    ).toEqual([noChanges]);
    const renamed = present(
      { appointments: [a] },
      { appointments: [appointment({ employeeDisplayName: "Alex New" })] },
    );
    expect(renamed.changes).toEqual([
      { field: "Service staff", before: "Alex", after: "Alex New" },
    ]);
  });

  it("keeps duplicate names distinguishable and missing legacy identities explicit", () => {
    const group = {
      appointments: [
        appointment({ employeeId: "staff-A" }),
        appointment({ employeeId: "staff-B" }),
      ],
    };
    expect(present(null, group).summary).toContain(
      "Service staff: Alex (staff-A), Alex (staff-B)",
    );
    const legacy = appointment({ employeeId: undefined });
    expect(present(null, legacy).summary).toContain(
      "Service staff: Alex (ID missing)",
    );
    expect(present(legacy, legacy).summary).toEqual([noChanges]);
    expect(
      present(
        null,
        appointment({ employeeId: undefined, employeeDisplayName: undefined }),
      ).summary,
    ).toContain("Service staff: Unknown staff (ID missing)");
    expect(present(legacy, appointment()).changes).toContainEqual({
      field: "Service staff",
      before: "Alex (ID missing)",
      after: "Alex (staff-1)",
    });
  });
  it("shows a retained employee rename alongside membership additions without duplicate aggregate changes", () => {
    const result = present(
      { appointments: [appointment()] },
      {
        appointments: [
          appointment({ employeeDisplayName: "Alex New" }),
          appointment({ employeeId: "staff-2", employeeDisplayName: "Sam" }),
        ],
      },
    );
    expect(result.changes).toEqual([
      { field: "Service staff", before: "Alex", after: "Alex New" },
      { field: "Party size", before: "1", after: "2" },
      { field: "Added staff", before: "", after: "Sam" },
    ]);
  });
  it("does not invent membership identities for name-only group history", () => {
    const result = present(
      { appointments: [appointment({ employeeId: undefined })] },
      {
        appointments: [
          appointment({ employeeId: undefined, employeeDisplayName: "Sam" }),
        ],
      },
    );
    expect(result.changes).toEqual([
      {
        field: "Service staff",
        before: "Alex (ID missing)",
        after: "Sam (ID missing)",
      },
    ]);
  });
});
