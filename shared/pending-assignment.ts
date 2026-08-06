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

export function isPendingAssignmentEmployeeUsername(username?: string | null, runtime?: PendingAssignmentRuntime) {
  const normalizedUsername = username?.trim();
  if (!normalizedUsername) {
    return false;
  }

  return normalizedUsername === getPendingAssignmentEmployeeUsername(runtime);
}

export function isPendingAssignmentEmployee(
  user?: { username?: string | null } | null,
  runtime?: PendingAssignmentRuntime,
) {
  return isPendingAssignmentEmployeeUsername(user?.username, runtime);
}
