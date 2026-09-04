export interface PendingAssignmentRuntime {
  env?: Record<string, string | undefined>;
}

export const DEFAULT_PENDING_EMPLOYEE_USERNAME = 'pending_assignment';
export const DEFAULT_PENDING_EMPLOYEE_COLOR = '#64748b';

export function getPendingAssignmentEmployeeUsername(runtime?: PendingAssignmentRuntime) {
  const override = runtime?.env?.PENDING_EMPLOYEE_USERNAME ?? runtime?.env?.VITE_PENDING_EMPLOYEE_USERNAME;
  const trimmedOverride = override?.trim();

  return trimmedOverride || DEFAULT_PENDING_EMPLOYEE_USERNAME;
}

// Each shop has its own pending-assignment placeholder employee, since usernames stay globally
// unique. The shop id is appended so real employee usernames never collide with it.
export function getPendingAssignmentEmployeeUsernameForShop(shopId: string, runtime?: PendingAssignmentRuntime) {
  return `${getPendingAssignmentEmployeeUsername(runtime)}__${shopId}`;
}

export function isPendingAssignmentEmployeeUsername(username?: string | null, runtime?: PendingAssignmentRuntime) {
  const normalizedUsername = username?.trim();
  if (!normalizedUsername) {
    return false;
  }

  const base = getPendingAssignmentEmployeeUsername(runtime);
  // Matches both the legacy single-tenant username and the per-shop "<base>__<shopId>" form.
  return normalizedUsername === base || normalizedUsername.startsWith(`${base}__`);
}

export function isPendingAssignmentEmployee(
  user?: { username?: string | null } | null,
  runtime?: PendingAssignmentRuntime,
) {
  return isPendingAssignmentEmployeeUsername(user?.username, runtime);
}
