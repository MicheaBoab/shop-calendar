// Read-only real Dev HTTP verification. No PII or tokens are printed.
require('dotenv/config');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { JwtService } = require('@nestjs/jwt');

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.port, '5432');
  assert.equal(url.pathname, '/shop_calendar');
  assert.ok(process.env.JWT_ACCESS_SECRET, 'Explicit local access secret required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
      select: { id: true, username: true, role: true, shopId: true, updatedAt: true },
    });
    const shops = await prisma.shop.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    assert.ok(shops.length >= 2, 'At least two real local shops required');
    const jwt = new JwtService();
    const globalManagers = await prisma.managerColorMap.findMany({ select: { userId: true, color: true } });
    const employeeMaps = await prisma.staffColorMap.findMany({ select: { shopId: true, userId: true, color: true } });
    const rosters = [];
    for (const shop of shops) {
      const token = jwt.sign({
        sub: admin.id, username: admin.username, role: admin.role,
        shopId: admin.shopId, activeShopId: shop.id, uv: admin.updatedAt.getTime(),
      }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '2m' });
      const response = await fetch('http://localhost:3000/users/staff', { headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200);
      const staff = await response.json();
      for (const row of staff) {
        assert.ok(['EMPLOYEE', 'MANAGER'].includes(row.role));
        assert.match(row.color, /^#[0-9a-f]{6}$/i);
        assert.ok(!Object.hasOwn(row, 'passwordHash') && !Object.hasOwn(row, 'password'));
        if (row.username.startsWith('pending_assignment')) {
          assert.equal(row.color, '#64748b');
        } else if (row.role === 'MANAGER') {
          assert.equal(row.color, globalManagers.find((m) => m.userId === row.id)?.color);
        } else {
          assert.equal(row.color, employeeMaps.find((m) => m.userId === row.id && m.shopId === shop.id)?.color);
        }
      }
      rosters.push(staff);
    }
    const activeManagers = rosters[0].filter((row) => row.role === 'MANAGER');
    assert.ok(activeManagers.length > 0, 'Real active managers required');
    for (const manager of activeManagers) {
      for (const roster of rosters) assert.equal(roster.find((r) => r.id === manager.id)?.color, manager.color);
    }
    if (process.argv[2] === '--anonymous-browser-fixture') {
      const source = rosters.find((r) => r.filter((u) => u.role === 'EMPLOYEE' && !u.username.startsWith('pending_assignment')).length >= 2);
      assert.ok(source, 'Two persisted employees needed for browser fixture');
      console.log(JSON.stringify({ staff: source.map((row, index) => ({
        id: `fixture-${index}`, username: row.username.startsWith('pending_assignment') ? 'pending_assignment__fixture-shop' : `fixture-login-${index}`,
        displayName: row.role === 'MANAGER' ? 'Fixture Manager' : `Fixture Staff ${index}`,
        role: row.role, status: 'ACTIVE', color: row.color,
      })) }));
    } else {
      console.log(JSON.stringify({
        realLocalHttpReadOnly: true, shopsVerified: shops.length,
        activeManagersVerifiedAcrossAllShops: activeManagers.length,
        managerHexes: activeManagers.map((m) => m.color),
        employeeMaps: employeeMaps.length, managerMaps: globalManagers.length,
        appointments: await prisma.appointment.count(),
        noSecretsOrPersonalDetailsPrinted: true,
      }));
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
