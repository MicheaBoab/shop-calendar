// Read-only production algorithm fixture. No app import, DB access or seed.
require('ts-node/register/transpile-only');
const {
  chooseColor,
  colorFamily,
  colorDistance,
  BASE_COLORS,
  COLOR_CANDIDATES,
} = require('../src/staff-colors/color-palette');
const pending = '#64748b';
const after = [],
  before = [];
for (let i = 0; i < 5; i++) {
  after.push(chooseColor(after, pending));
  const score = (c) =>
    Math.min(...[...before, pending].map((u) => colorDistance(c, u)));
  const best = (candidates) =>
    candidates
      .filter((c) => !before.includes(c) && c !== pending)
      .reduce((a, b) => (score(b) > score(a) ? b : a));
  const base = best(BASE_COLORS);
  before.push(score(base) >= 20 ? base : best(COLOR_CANDIDATES));
}
console.log(
  JSON.stringify({
    before,
    after,
    families: after.map(colorFamily),
    staff: [
      ...after.map((color, i) => ({
        id: `fixture-${i}`,
        username: `fixture-${i}`,
        displayName: `Fixture ${i}`,
        role: i === 0 ? 'MANAGER' : 'EMPLOYEE',
        status: 'ACTIVE',
        color,
      })),
      {
        id: 'pending',
        username: 'pending_assignment__fixture-shop',
        displayName: 'Pending',
        role: 'EMPLOYEE',
        status: 'ACTIVE',
        color: pending,
      },
    ],
  }),
);
