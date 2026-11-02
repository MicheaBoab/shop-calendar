import type { Locale } from "./i18n/messages";

type JsonRecord = Record<string, unknown>;

export interface AuditDiffEntry {
  field: string;
  before: string;
  after: string;
}

export interface AuditPresentation {
  legacyMissing: boolean;
  unrecognizedPayload: boolean;
  created: boolean;
  summary: string[];
  changes: AuditDiffEntry[];
}

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const safeText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value === null) return "—";
  return "";
};

const isAppointmentGroup = (value: JsonRecord) =>
  Array.isArray(value.appointments);

const hasRecognizedShape = (value: JsonRecord, entityType: string) => {
  const keys =
    entityType === "appointment"
      ? ["appointments", "employeeId", "startAt", "phone", "groupId"]
      : entityType === "settings"
        ? ["slotMinTime", "slotMaxTime"]
        : entityType === "user"
          ? ["username", "displayName", "role", "status"]
          : [
              "appointments",
              "employeeId",
              "startAt",
              "phone",
              "groupId",
              "slotMinTime",
              "slotMaxTime",
              "username",
              "displayName",
              "role",
            ];
  return keys.some((key) => key in value);
};

const activeMembers = (value: JsonRecord | null) => {
  if (!value) return [];
  const rows = Array.isArray(value.appointments)
    ? value.appointments.filter(isRecord)
    : [value];
  return rows
    .filter((row) => !row.deletedAt)
    .map((row) => {
      const id = safeText(row.employeeId);
      const name = safeText(row.employeeDisplayName);
      return {
        id,
        name,
        key: id ? `id:${id}` : name ? `legacy:${name}` : "unknown",
      };
    });
};

const appointmentValues = (
  value: JsonRecord,
  employeeLabels: string[],
): JsonRecord => {
  const appointments = Array.isArray(value.appointments)
    ? value.appointments.filter(isRecord)
    : [];
  const activeAppointments = appointments.filter(
    (appointment) => !appointment.deletedAt,
  );
  const first = activeAppointments[0] ?? appointments[0] ?? value;
  const hiddenCount = appointments.filter((appointment) =>
    Boolean(appointment.deletedAt),
  ).length;

  return {
    employee: employeeLabels.join(", "),
    partySize: Array.isArray(value.appointments)
      ? activeAppointments.length
      : undefined,
    startAt: first.startAt,
    endAt: first.endAt,
    phone: first.phone,
    price: first.price,
    customerName: first.customerName,
    serviceName: first.serviceName,
    note: first.note,
    status: first.status,
    hidden: hiddenCount ? `${hiddenCount} hidden` : "visible",
  };
};

const userValues = (value: JsonRecord): JsonRecord => ({
  username: value.username,
  displayName: value.displayName,
  role: value.role,
  status: value.status,
  deletedAt: value.deletedAt ? "removed" : "active",
});

const settingsValues = (value: JsonRecord): JsonRecord => ({
  slotMinTime: value.slotMinTime,
  slotMaxTime: value.slotMaxTime,
});

const equalValue = (left: unknown, right: unknown) =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

export function getAuditPresentation(
  beforePayload: unknown,
  afterPayload: unknown,
  entityType: string,
  locale: Locale,
  formatDate: (value: string) => string,
  legacyMissingLabel: string,
  noChangesLabel: string,
  unrecognizedLabel = legacyMissingLabel,
): AuditPresentation {
  const before = isRecord(beforePayload) ? beforePayload : null;
  const after = isRecord(afterPayload) ? afterPayload : null;
  if (!before && !after) {
    return {
      legacyMissing: true,
      unrecognizedPayload: false,
      created: false,
      summary: [legacyMissingLabel],
      changes: [],
    };
  }
  if (
    (before && !hasRecognizedShape(before, entityType)) ||
    (after && !hasRecognizedShape(after, entityType))
  ) {
    return {
      legacyMissing: false,
      unrecognizedPayload: true,
      created: false,
      summary: [unrecognizedLabel],
      changes: [],
    };
  }

  const appointmentShape =
    entityType === "appointment" ||
    Boolean(before && isAppointmentGroup(before)) ||
    Boolean(after && isAppointmentGroup(after));
  const settingsShape = entityType === "settings";
  const beforeMembers = activeMembers(before);
  const afterMembers = activeMembers(after);
  const allMembers = [...beforeMembers, ...afterMembers];
  const memberLabel = (member: (typeof allMembers)[number]) => {
    if (!member.id) {
      return `${member.name || (locale === "zh-CN" ? "未知员工" : "Unknown staff")} (${locale === "zh-CN" ? "缺少ID" : "ID missing"})`;
    }
    const name =
      member.name || (locale === "zh-CN" ? "未知员工" : "Unknown staff");
    const duplicates = allMembers.filter((other) => other.name === member.name);
    if (new Set(duplicates.map((other) => other.key)).size <= 1 && member.name)
      return name;
    const short = member.id.slice(-8);
    const collides = duplicates.some(
      (other) => other.id !== member.id && other.id.slice(-8) === short,
    );
    return `${name} (${collides ? member.id : short})`;
  };
  const memberLabels = (members: typeof allMembers) =>
    [...new Set(members.map(memberLabel))].sort();
  const beforeSet = new Set(beforeMembers.map((member) => member.key));
  const afterSet = new Set(afterMembers.map((member) => member.key));
  const added = afterMembers.filter((member) => !beforeSet.has(member.key));
  const removed = beforeMembers.filter((member) => !afterSet.has(member.key));
  // Name-only legacy snapshots cannot prove membership identity.
  const canCompareMembership = allMembers.every((member) => Boolean(member.id));
  const renamedIds = new Set(
    beforeMembers
      .filter(
        (member) =>
          member.id &&
          afterMembers.some(
            (next) => next.id === member.id && next.name !== member.name,
          ),
      )
      .map((member) => member.id),
  );
  const groupMembershipChanged = Boolean(
    before &&
    after &&
    isAppointmentGroup(before) &&
    isAppointmentGroup(after) &&
    canCompareMembership &&
    (added.length || removed.length),
  );
  const beforeValues = before
    ? appointmentShape
      ? appointmentValues(before, memberLabels(beforeMembers))
      : settingsShape
        ? settingsValues(before)
        : userValues(before)
    : null;
  const afterValues = after
    ? appointmentShape
      ? appointmentValues(after, memberLabels(afterMembers))
      : settingsShape
        ? settingsValues(after)
        : userValues(after)
    : null;
  const labels: Record<string, string> = appointmentShape
    ? locale === "zh-CN"
      ? {
          employee: "服务员工",
          partySize: "人数",
          startAt: "开始时间",
          endAt: "结束时间",
          phone: "电话",
          price: "价格",
          customerName: "客户",
          serviceName: "服务",
          note: "备注",
          status: "状态",
          hidden: "日历显示",
        }
      : {
          employee: "Service staff",
          partySize: "Party size",
          startAt: "Start",
          endAt: "End",
          phone: "Phone",
          price: "Price",
          customerName: "Customer",
          serviceName: "Service",
          note: "Note",
          status: "Status",
          hidden: "Calendar visibility",
        }
    : settingsShape
      ? locale === "zh-CN"
        ? { slotMinTime: "营业开始", slotMaxTime: "营业结束" }
        : { slotMinTime: "Opening time", slotMaxTime: "Closing time" }
      : locale === "zh-CN"
        ? {
            username: "用户名",
            displayName: "显示名称",
            role: "角色",
            status: "状态",
            deletedAt: "账户",
          }
        : {
            username: "Username",
            displayName: "Display name",
            role: "Role",
            status: "Status",
            deletedAt: "Account",
          };

  const keys = Object.keys(labels);
  const changes = keys.flatMap((key) => {
    const membershipEmployee = key === "employee" && groupMembershipChanged;
    if (membershipEmployee && !renamedIds.size) return [];
    const previous = membershipEmployee
      ? memberLabels(
          beforeMembers.filter((member) => renamedIds.has(member.id)),
        ).join(", ")
      : beforeValues?.[key];
    const next = membershipEmployee
      ? memberLabels(
          afterMembers.filter((member) => renamedIds.has(member.id)),
        ).join(", ")
      : afterValues?.[key];
    if (!afterValues || (beforeValues && equalValue(previous, next))) return [];
    if (previous === undefined && next === undefined) return [];
    const format = (value: unknown) => {
      const text = safeText(value);
      if ((key === "startAt" || key === "endAt") && text && text !== "—") {
        const date = new Date(text);
        return Number.isNaN(date.getTime())
          ? text
          : formatDate(date.toISOString());
      }
      if (key === "role") {
        const roleLabels: Record<string, string> =
          locale === "zh-CN"
            ? {
                ADMIN: "管理员",
                MANAGER: "经理",
                EMPLOYEE: "普通员工",
                SHOP_ACCOUNT: "店铺共享账号",
              }
            : {
                ADMIN: "Administrator",
                MANAGER: "Manager",
                EMPLOYEE: "Employee",
                SHOP_ACCOUNT: "Shared shop account",
              };
        return roleLabels[text] ?? text;
      }
      if (key === "status") {
        const statusLabels: Record<string, string> =
          locale === "zh-CN"
            ? {
                ACTIVE: "启用",
                INACTIVE: "停用",
                SCHEDULED: "已预约",
                CANCELLED: "已取消",
                COMPLETED: "已完成",
              }
            : {
                ACTIVE: "Active",
                INACTIVE: "Inactive",
                SCHEDULED: "Scheduled",
                CANCELLED: "Cancelled",
                COMPLETED: "Completed",
              };
        return statusLabels[text] ?? text;
      }
      return text;
    };
    return [
      {
        field: labels[key],
        before: beforeValues ? format(previous) : "",
        after: format(next),
      },
    ];
  });

  const memberChanges: AuditDiffEntry[] = [];
  if (
    appointmentShape &&
    before &&
    after &&
    canCompareMembership &&
    isAppointmentGroup(before) &&
    isAppointmentGroup(after)
  ) {
    if (added.length) {
      memberChanges.push({
        field: locale === "zh-CN" ? "新增服务员工" : "Added staff",
        before: "",
        after: memberLabels(added).join(", "),
      });
    }
    if (removed.length) {
      memberChanges.push({
        field: locale === "zh-CN" ? "移除服务员工" : "Removed staff",
        before: "",
        after: memberLabels(removed).join(", "),
      });
    }
  }

  changes.push(...memberChanges);
  const summary = changes.map((change) =>
    change.before
      ? `${change.field}: ${change.before} → ${change.after}`
      : `${change.field}: ${change.after}`,
  );

  return {
    legacyMissing: false,
    unrecognizedPayload: false,
    created: !before && Boolean(after),
    summary: summary.length ? summary : [noChangesLabel],
    changes,
  };
}
