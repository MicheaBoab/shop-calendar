import {
  COLOR_CANDIDATES,
  FAMILY_COLORS,
  calendarEventColor,
  chooseColor,
  colorDistance,
  colorFamily,
  hueDistance,
  luminance,
  normalizeColor,
  renderedColorDistance,
} from './color-palette';
import { DEFAULT_PENDING_EMPLOYEE_COLOR as pending } from '../common/pending-assignment';

const allocate = (count: number, initial: string[] = []) => {
  const colors = [...initial];
  for (let i = 0; i < count; i++) colors.push(chooseColor(colors, pending));
  return colors;
};
const minimum = (colors: string[]) =>
  Math.min(
    ...colors.flatMap((c, i) =>
      colors.slice(i + 1).map((d) => colorDistance(c, d)),
    ),
  );
const legacyMix = (color: string) =>
  `#${[1, 3, 5]
    .map((offset, i) =>
      Math.round(
        [15, 23, 42][i] * 0.72 +
          parseInt(color.slice(offset, offset + 2), 16) * 0.28,
      )
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
// Captured before changes from the production allocator for the 12-person fixture.
const legacy12 = [
  '#facc15',
  '#4ade80',
  '#e879f9',
  '#f87171',
  '#22d3ee',
  '#818cf8',
  '#eec287',
  '#b1ef39',
  '#7839ef',
  '#e78dc0',
  '#fb923c',
  '#ef39a1',
];

describe('family-first finite dark accent allocator (Delta E 76)', () => {
  it('spreads the first six across six families and keeps later colors unique', () => {
    const colors = allocate(8);
    for (const n of [3, 5, 6, 8])
      expect(new Set(colors.slice(0, n).map(colorFamily)).size).toBe(
        Math.min(n, 6),
      );
    expect(new Set(colors).size).toBe(8);
  });

  it('improves 8–12 staff separation using the actual 40% calendar tint', () => {
    const before = legacy12.map(legacyMix);
    for (const count of [8, 10, 12]) {
      const after = allocate(count).map(calendarEventColor);
      expect(minimum(after)).toBeGreaterThan(minimum(before.slice(0, count)));
      expect(minimum(after)).toBeGreaterThan(15);
      expect(new Set(allocate(count)).size).toBe(count);
    }
    expect(minimum(before)).toBeCloseTo(11.2036, 3);
    const after = allocate(12).map(calendarEventColor);
    expect(minimum(after)).toBeGreaterThan(minimum(before) + 4);
    const lightText = luminance('#f8fafc');
    expect(
      Math.min(
        ...COLOR_CANDIDATES.map((color) => {
          const background = luminance(calendarEventColor(color));
          return (lightText + 0.05) / (background + 0.05);
        }),
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(renderedColorDistance('#60a5fa', '#60a5fa')).toBe(0);
  });

  it('reserves an existing manager family before employee allocation', () => {
    const colors = allocate(4, ['hsl(48 90% 55%)']);
    expect(new Set(colors.map(colorFamily)).size).toBe(5);
    expect(colorFamily('#a3e635')).toBe(colorFamily('#facc15'));
    expect(colorFamily('#fbbf24')).toBe(colorFamily('#fb923c'));
  });

  it('normalizes historical HEX/HSL reservations, rejecting invalid used and pending', () => {
    expect(normalizeColor(' HSL(-360deg, 100%, 50%) ')).toBe('#ff0000');
    expect(normalizeColor('#ABC')).toBe('#aabbcc');
    expect(chooseColor(['#FACC15'], pending)).toBe(
      chooseColor(['hsl(47.9476 96.6245% 53.5294%)'], pending),
    );
    for (const invalid of ['bad', 'hsl(0 101% 50%)', '#12345'])
      expect(() => chooseColor([invalid], pending)).toThrow(
        'Invalid staff color',
      );
    expect(() => chooseColor([], 'bad')).toThrow('Invalid staff color');
  });

  it('handles red wrap, red/purple and blue/cyan boundaries, not only sector labels', () => {
    expect(hueDistance(359, 1)).toBe(2);
    expect(hueDistance(215, 190)).toBe(25);
    expect(colorFamily('hsl(359 80% 65%)')).toBe(colorFamily('hsl(1 80% 65%)'));
    for (const existing of [
      'hsl(330 80% 65%)',
      'hsl(215 80% 65%)',
      'hsl(180 80% 65%)',
    ]) {
      const result = allocate(2, [existing]);
      expect(new Set(result.map(colorFamily)).size).toBe(3);
      expect(minimum(result.map(normalizeColor))).toBeGreaterThan(40);
    }
    // Different nearest-anchor labels, but <40 degrees apart: guard blocks cyan.
    expect(colorFamily('hsl(212 80% 65%)')).toBe(4);
    expect(allocate(5, ['hsl(212 80% 65%)']).slice(1)).not.toContain('#22d3ee');
  });

  it('pending and neutral gray reserve distance but occupy no service family', () => {
    expect(colorFamily('#888888')).toBeNull();
    expect(allocate(5, [pending]).slice(1)).toEqual(allocate(5));
    expect(
      new Set(allocate(6, ['#888888']).slice(1).map(colorFamily)).size,
    ).toBe(6);
    expect(
      allocate(5).every((c) => renderedColorDistance(c, pending) >= 20),
    ).toBe(
      true,
    );
  });

  it('falls back to global maximin when families are occupied or anchors reserved', () => {
    const used = [...FAMILY_COLORS];
    const selected = chooseColor(used, pending);
    const score = (c: string) =>
      Math.min(
        ...[...used, pending].map((u) => renderedColorDistance(c, u)),
      );
    expect(score(selected)).toBeCloseTo(
      Math.max(...COLOR_CANDIDATES.filter((c) => !used.includes(c)).map(score)),
    );
    const almostAll = COLOR_CANDIDATES.slice(0, -1);
    expect(chooseColor(almostAll, pending)).toBe(COLOR_CANDIDATES.at(-1));
    expect(() => chooseColor(COLOR_CANDIDATES, pending)).toThrow(
      'candidates exhausted',
    );
  });

  it('allocates 100 distinct deterministic valid accents without changing inputs', () => {
    const colors = allocate(100);
    expect(allocate(100)).toEqual(colors);
    expect(new Set(colors).size).toBe(100);
    expect(COLOR_CANDIDATES).toHaveLength(727);
    for (const color of colors) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
      expect(color).not.toBe(pending);
      expect(
        (luminance(color) + 0.05) / (luminance('#0f172a') + 0.05),
      ).toBeGreaterThanOrEqual(3);
    }
    const input = ['#60a5fa'];
    chooseColor(input, pending);
    expect(input).toEqual(['#60a5fa']);
    expect(colorDistance('#ffffff', '#ffffff')).toBe(0);
  });
});
