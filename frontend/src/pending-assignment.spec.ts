import { describe, expect, it } from 'vitest';
import { getPendingAssignmentEmployeeUsername, isPendingAssignmentEmployee } from './pending-assignment';

describe('pending assignment helpers', () => {
  it('uses the default pending employee username when no override is configured', () => {
    expect(getPendingAssignmentEmployeeUsername()).toBe('pending_assignment');
  });

  it('treats the configured pending employee username as pending', () => {
    expect(isPendingAssignmentEmployee({ username: 'pending_assignment' })).toBe(true);
    expect(isPendingAssignmentEmployee({ username: 'other-user' })).toBe(false);
  });
});
