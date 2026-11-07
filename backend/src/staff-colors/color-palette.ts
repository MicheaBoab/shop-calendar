// CIELAB Euclidean distance (Delta E 76), not CIEDE2000.
// These are accents on a dark background, not backgrounds for white text.
import {
  CALENDAR_EVENT_BACKGROUND_DARK,
  CALENDAR_EVENT_EMPLOYEE_TINT,
} from '../../../shared/calendar-colors';

export const BASE_COLORS = [
  '#60a5fa',
  '#fb923c',
  '#4ade80',
  '#f472b6',
  '#facc15',
  '#a78bfa',
  '#22d3ee',
  '#f87171',
  '#a3e635',
  '#e879f9',
  '#2dd4bf',
  '#fbbf24',
  '#818cf8',
  '#fb7185',
  '#38bdf8',
  '#c4b5fd',
];

function hslHex(h: number, s: number, l: number) {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function luminance(hex: string) {
  const rgb = linearRgb(hex);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function linearRgb(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Invalid palette hex');
  return [1, 3, 5].map((offset) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
}

function lab(hex: string) {
  const [r, g, b] = linearRgb(hex);
  const f = (t: number) =>
    t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
  const x = f((r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047);
  const y = f(r * 0.2126729 + g * 0.7151522 + b * 0.072175);
  const z = f((r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function colorDistance(a: string, b: string) {
  const left = lab(a);
  const right = lab(b);
  return Math.hypot(...left.map((v, i) => v - right[i]));
}

export function calendarEventColor(employeeColor: string) {
  const color = normalizeColor(employeeColor);
  const background = CALENDAR_EVENT_BACKGROUND_DARK;
  const tint = CALENDAR_EVENT_EMPLOYEE_TINT / 100;
  return `#${[1, 3, 5]
    .map((offset) =>
      Math.round(
        parseInt(background.slice(offset, offset + 2), 16) * (1 - tint) +
          parseInt(color.slice(offset, offset + 2), 16) * tint,
      )
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export function renderedColorDistance(a: string, b: string) {
  return colorDistance(calendarEventColor(a), calendarEventColor(b));
}

export const COLOR_CANDIDATES = [
  ...new Set([
    ...BASE_COLORS,
    ...Array.from({ length: 720 }, (_, i) =>
      hslHex((i * 137.508) % 360, 0.65 + (i % 3) * 0.1, 0.58 + (i % 4) * 0.05),
    ),
  ]),
].filter((hex) => (luminance(hex) + 0.05) / (luminance('#0f172a') + 0.05) >= 3);

// Applied after the employee accent is mixed into the shared dark card background.
export const PREFERRED_DISTANCE = 20;

// Six separated anchors, not six hard hue sectors. Yellow/lime share a family;
// pink/magenta/purple share one too. The circular guard also crosses boundaries.
export const FAMILY_COLORS = [
  '#f87171', // red
  '#facc15', // amber/yellow
  '#4ade80', // green
  '#22d3ee', // cyan
  '#818cf8', // blue
  '#e879f9', // purple/pink
];
export const MIN_FAMILY_HUE_DISTANCE = 40;

export function normalizeColor(value: string): string {
  const color = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color))
    return `#${color
      .slice(1)
      .split('')
      .map((c) => c + c)
      .join('')}`;
  const number = '([+-]?(?:\\d*\\.)?\\d+)';
  const match = color.match(
    new RegExp(
      `^hsl\\(\\s*${number}(deg)?[\\s,]+${number}%[\\s,]+${number}%\\s*\\)$`,
    ),
  );
  if (match) {
    const [, h, , s, l] = match;
    if (+s >= 0 && +s <= 100 && +l >= 0 && +l <= 100)
      return hslHex(((+h % 360) + 360) % 360, +s / 100, +l / 100);
  }
  throw new Error('Invalid staff color');
}

function hue(hex: string): number | null {
  const [r, g, b] = [1, 3, 5].map(
    (offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  // Low-chroma historical gray is a distance reservation, not a service family.
  if (delta < 0.1 || delta / (1 - Math.abs(max + min - 1)) < 0.18) return null;
  const h =
    max === r
      ? (g - b) / delta
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return (((h * 60) % 360) + 360) % 360;
}

export function hueDistance(a: number, b: number) {
  const distance = Math.abs(a - b) % 360;
  return Math.min(distance, 360 - distance);
}

export function colorFamily(color: string): number | null {
  const h = hue(normalizeColor(color));
  if (h === null) return null;
  return FAMILY_COLORS.reduce(
    (best, anchor, index) =>
      hueDistance(h, hue(anchor)!) < hueDistance(h, hue(FAMILY_COLORS[best])!)
        ? index
        : best,
    0,
  );
}

export function chooseColor(used: string[], pending: string, excluded: string[] = []) {
  const normalizedPending = normalizeColor(pending);
  const normalizedUsed = used.map(normalizeColor);
  const reserved = new Set([...normalizedUsed, normalizedPending]);
  const references = [...reserved];
  const renderedReferences = references.map(calendarEventColor);
  const skipped = new Set(excluded);
  const score = (color: string) => {
    const current = calendarEventColor(color);
    return Math.min(
      ...renderedReferences.map((other) => colorDistance(current, other)),
    );
  };
  const best = (candidates: string[]) =>
    candidates
      .filter((c) => !reserved.has(c) && !skipped.has(c))
      .reduce<{ color: string; distance: number } | null>((winner, color) => {
        const distance = score(color);
        return !winner || distance > winner.distance
          ? { color, distance }
          : winner;
      }, null);
  const serviceColors = normalizedUsed.filter((c) => c !== normalizedPending);
  const occupied = new Set(serviceColors.map(colorFamily));
  const usedHues = serviceColors.map(hue).filter((h) => h !== null);
  const freshFamily = (color: string) =>
    !occupied.has(colorFamily(color)) &&
    usedHues.every(
      (h) => hueDistance(h, hue(color)!) >= MIN_FAMILY_HUE_DISTANCE,
    ) &&
    score(color) >= PREFERRED_DISTANCE;
  const separated =
    best(FAMILY_COLORS.filter(freshFamily)) ??
    best(COLOR_CANDIDATES.filter(freshFamily));
  if (separated) return separated.color;
  // No safe empty family (or all occupied): never strand a new staff member.
  // Exact reservations still apply; only true finite exhaustion throws.
  const chosen = best(COLOR_CANDIDATES);
  if (!chosen) throw new Error('Staff color candidates exhausted');
  return chosen.color;
}
