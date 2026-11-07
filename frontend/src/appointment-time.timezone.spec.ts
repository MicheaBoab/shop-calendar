import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// Fresh Node processes avoid worker/global TZ mutations. Exercise the actual date helpers.
const probe = (tz: string, date: string) => JSON.parse(execFileSync(process.execPath, [
  '--experimental-strip-types', '--input-type=module', '-e', `
    import { parseUsDateInput, formatDateForUsInput, computeEndFromDuration,
      shiftUsDateInputByDays, crossesIntoNextDay } from './src/appointment-time.ts';
    const start = parseUsDateInput(${JSON.stringify(date)});
    start.setHours(10);
    const end = computeEndFromDuration(start, 45);
    const late = new Date(start); late.setHours(23, 45);
    console.log(JSON.stringify({ utc:start.toISOString(), date:formatDateForUsInput(start),
      duration:(end-start)/60000, next:shiftUsDateInputByDays(${JSON.stringify(date)},1),
      crosses:crossesIntoNextDay(late,computeEndFromDuration(late,30)) }));
  `,
], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }));

describe('Device-local date helpers under explicit timezone processes', () => {
  it.each([
    ['01/15/2026', '2026-01-15T16:00:00.000Z', '01/16/2026'],
    ['07/15/2026', '2026-07-15T15:00:00.000Z', '07/16/2026'],
    ['03/07/2026', '2026-03-07T16:00:00.000Z', '03/08/2026'],
    ['03/08/2026', '2026-03-08T15:00:00.000Z', '03/09/2026'],
    ['10/31/2026', '2026-10-31T15:00:00.000Z', '11/01/2026'],
    ['11/01/2026', '2026-11-01T16:00:00.000Z', '11/02/2026'],
  ])('Chicago %s handles DST, date navigation, 45 minutes and midnight', (date, utc, next) => {
    expect(probe('America/Chicago', date)).toEqual({ utc, date, next, duration: 45, crosses: true });
  });

  it('documents that identical wall-clock entry on another device timezone produces a different instant', () => {
    expect(probe('UTC', '07/15/2026').utc).toBe('2026-07-15T10:00:00.000Z');
    expect(probe('America/Chicago', '07/15/2026').utc).toBe('2026-07-15T15:00:00.000Z');
  });
});
