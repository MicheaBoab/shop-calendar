import { describe, expect, it } from 'vitest';
import { assertPersistedStaffColors } from './staff-colors';

describe('staff API persistent color contract', () => {
  it('accepts different IDs with identical names, and global manager hex', () => {
    expect(() => assertPersistedStaffColors([
      { id: 'e1', username: 'same', role: 'EMPLOYEE', color: '#60a5fa' },
      { id: 'e2', username: 'same', role: 'EMPLOYEE', color: '#4ade80' },
      { id: 'm1', username: 'manager', role: 'MANAGER', color: '#f472b6' },
      { id: 'pending', username: 'pending_assignment__s', role: 'EMPLOYEE' },
      { id: 'admin', username: 'admin', role: 'ADMIN' },
    ])).not.toThrow();
  });
  it('rejects missing/name-hash colors instead of silently recoloring normal staff', () => {
    for (const color of [undefined, 'hsl(17 70% 56%)', 'bad']) {
      expect(() => assertPersistedStaffColors([{ id: 'e1', username: 'staff', role: 'EMPLOYEE', color }])).toThrow();
    }
  });
});
