import { isPendingAssignmentEmployee, type PendingAssignmentRuntime } from '../../shared/pending-assignment';

export function assertPersistedStaffColors(
  staff: Array<{ id: string; username: string; role: string; color?: string }>,
  runtime?: PendingAssignmentRuntime,
) {
  for (const user of staff) {
    if (user.role !== 'EMPLOYEE' && user.role !== 'MANAGER') continue;
    if (isPendingAssignmentEmployee(user, runtime)) continue;
    if (!user.id || !/^#[0-9a-f]{6}$/i.test(user.color ?? '')) {
      throw new Error('Service staff color is missing or invalid; refresh after backend color initialization.');
    }
  }
}
