import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { StaffColorsService } from '../src/staff-colors/staff-colors.service';
import { getPendingAssignmentEmployeeUsernameForShop } from '../src/common/pending-assignment';

// Opt-in only. A mistyped target must fail before importing/initializing an app connection.
const optedIn = process.env.RUN_CURRENT_UI_LOCAL === '1';
const target = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (optedIn && !(target?.hostname === '127.0.0.1' && target.port === '55439'
  && target.pathname === '/shop_calendar_guide_20261103')) {
  throw new Error('Current UI integration requires the newly created guide database on 127.0.0.1:55439');
}

(optedIn ? describe : describe.skip)('Current UI contracts with real PostgreSQL and HTTP', () => {
  let app: INestApplication;
  let db: PrismaService;
  let auth: AuthService;
  let shop: string;
  let otherShop: string;
  let staff: string;
  let pending: string;
  const tokens = new Map<UserRole, string>();
  const ids = new Map<UserRole, string>();
  const password = randomUUID();
  const prefix = `guide-${randomUUID().slice(0, 8)}`;
  let sequence = 0;
  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);
  const booking = () => {
    const start = new Date(Date.UTC(2099, 0, 1 + sequence++, 16));
    return {
      employeeIds: [staff], partySize: 1, phone: '3125550101',
      startAt: start.toISOString(), endAt: new Date(+start + 45 * 60_000).toISOString(),
    };
  };
  const create = async (body: object, role = UserRole.ADMIN) =>
    http().post('/appointments').auth(tokens.get(role)!, { type: 'bearer' }).send(body);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(PrismaService);
    auth = app.get(AuthService);
    shop = (await db.shop.create({ data: { name: `${prefix} A` } })).id;
    otherShop = (await db.shop.create({ data: { name: `${prefix} B` } })).id;
    const passwordHash = await bcrypt.hash(password, 4);
    for (const role of Object.values(UserRole)) {
      const user = await db.user.create({
        data: { username: `${prefix}-${role}`, displayName: `Guide ${role}`,
          role, shopId: shop, passwordHash },
      });
      ids.set(role, user.id);
      tokens.set(role, (await auth.selectShop(user.id, shop)).accessToken);
    }
    staff = ids.get(UserRole.EMPLOYEE)!;
    pending = (await db.user.create({
      data: { shopId: shop, username: getPendingAssignmentEmployeeUsernameForShop(shop),
        displayName: 'Pending Assignment', passwordHash },
    })).id;
    await app.get(StaffColorsService).initializeMissing();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.$disconnect();
    // Keep only fictional fixtures until the owning temporary container is removed.
  });

  it.each(Object.values(UserRole))('%s uses the login/selection flow and sees the same shared calendar', async role => {
    const login = await http().post('/auth/login').send({ username: `${prefix}-${role}`, password }).expect(201);
    expect(login.body.needsShopSelection).toBe(role === UserRole.ADMIN || role === UserRole.MANAGER);
    const created = await create(booking(), role);
    expect(created.status).toBe(201);
    const rows = await http().get('/appointments').auth(tokens.get(role)!, { type: 'bearer' }).expect(200);
    expect(rows.body.some((row: { id: string }) => row.id === created.body.appointments[0].id)).toBe(true);
    expect(created.body.appointments[0].price).toBe('0');
    const saved = await db.appointment.findUniqueOrThrow({ where: { id: created.body.appointments[0].id } });
    expect(saved.price).toBe(0);
    expect(saved.createdById).toBe(ids.get(role));
  });

  it.each(['312555010', '31255501012', '(312)555-0101'])('rejects invalid raw phone %s without creating rows', async phone => {
    const before = await db.appointment.count({ where: { shopId: shop } });
    expect((await create({ ...booking(), phone })).status).toBe(400);
    expect(await db.appointment.count({ where: { shopId: shop } })).toBe(before);
  });

  it('creates a partially assigned group, reassigns it and audits the full group atomically', async () => {
    const dto = { ...booking(), partySize: 3, price: '75', customerName: 'Fictional Customer', note: 'Guide fixture' };
    const response = await create(dto);
    expect(response.status).toBe(201);
    expect(response.body.appointments).toHaveLength(3);
    expect(response.body.pendingCount).toBe(2);
    expect(response.body.appointments.filter((r: { employeeId: string }) => r.employeeId === pending)).toHaveLength(2);
    expect(new Set(response.body.appointments.map((r: { groupId: string }) => r.groupId)).size).toBe(1);
    const first = response.body.appointments[0];
    await http().patch(`/appointments/${first.id}`).auth(tokens.get(UserRole.EMPLOYEE)!, { type: 'bearer' })
      .send({ employeeIds: [staff, ids.get(UserRole.MANAGER)], partySize: 3, note: 'Updated by employee' }).expect(200);
    const members = await db.appointment.findMany({ where: { groupId: first.groupId, deletedAt: null } });
    expect(members).toHaveLength(3);
    expect(members.filter(r => r.employeeId === pending)).toHaveLength(1);
    expect(members.every(r => r.price === 7500 && r.note === 'Updated by employee')).toBe(true);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: first.groupId, action: 'appointment.update' } });
    expect(audit.actorSnapshot).toMatchObject({ id: ids.get(UserRole.EMPLOYEE) });
    expect(audit.beforePayload).not.toBeNull();
    expect(audit.afterPayload).not.toBeNull();
  });

  it('serializes three concurrent overlapping creates: exactly one commits with one audit', async () => {
    const dto = booking();
    const responses = await Promise.all([
      create(dto, UserRole.ADMIN), create(dto, UserRole.EMPLOYEE), create(dto, UserRole.SHOP_ACCOUNT),
    ]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409, 409]);
    const rows = await db.appointment.findMany({ where: { shopId: shop, startAt: new Date(dto.startAt) } });
    expect(rows).toHaveLength(1);
    expect(await db.auditLog.count({ where: { entityId: rows[0].groupId, action: 'appointment.create' } })).toBe(1);
  });

  it('allows a touching boundary but rolls back every group member on a conflict', async () => {
    const dto = booking();
    expect((await create(dto)).status).toBe(201);
    const end = new Date(+new Date(dto.endAt) + 60 * 60_000).toISOString();
    expect((await create({ ...dto, startAt: dto.endAt, endAt: end })).status).toBe(201);
    const before = await db.appointment.count();
    expect((await create({ ...dto, employeeIds: [ids.get(UserRole.MANAGER), staff], partySize: 3 })).status).toBe(409);
    expect(await db.appointment.count()).toBe(before);
  });

  it('cancels the entire group, keeps it visible and frees the time for rebooking', async () => {
    const dto = { ...booking(), partySize: 2 };
    const created = await create(dto);
    const first = created.body.appointments[0];
    await http().post(`/appointments/${first.id}/cancel`)
      .auth(tokens.get(UserRole.SHOP_ACCOUNT)!, { type: 'bearer' }).expect(201);
    const rows = await http().get(`/appointments?groupId=${first.groupId}`)
      .auth(tokens.get(UserRole.EMPLOYEE)!, { type: 'bearer' }).expect(200);
    expect(rows.body).toHaveLength(2);
    expect(rows.body.every((r: { status: string }) => r.status === 'CANCELLED')).toBe(true);
    await http().patch(`/appointments/${first.id}`).auth(tokens.get(UserRole.EMPLOYEE)!, { type: 'bearer' })
      .send({ note: 'Cannot update cancelled booking' }).expect(409);
    expect((await create(dto)).status).toBe(201);
  });

  it.each([UserRole.EMPLOYEE, UserRole.SHOP_ACCOUNT])('%s cannot hide bookings, read logs or manage accounts/settings', async role => {
    const created = await create(booking());
    const bearer = tokens.get(role)!;
    await http().delete(`/appointments/${created.body.appointments[0].id}`).auth(bearer, { type: 'bearer' }).expect(403);
    await http().get('/audit/logs').auth(bearer, { type: 'bearer' }).expect(403);
    await http().post('/users').auth(bearer, { type: 'bearer' })
      .send({ username: `${prefix}-blocked`, displayName: 'Blocked', password }).expect(403);
    await http().patch('/system-settings/calendar-window').auth(bearer, { type: 'bearer' })
      .send({ slotMinTime: '09:00:00', slotMaxTime: '19:00:00' }).expect(403);
  });

  it('manager soft-hides the group; rows and audit snapshots remain, other shops cannot see it', async () => {
    const created = await create({ ...booking(), partySize: 2 });
    const first = created.body.appointments[0];
    const foreign = (await auth.selectShop(ids.get(UserRole.MANAGER)!, otherShop)).accessToken;
    await http().patch(`/appointments/${first.id}`).auth(foreign, { type: 'bearer' })
      .send({ note: 'Wrong shop' }).expect(404);
    await http().delete(`/appointments/${first.id}`).auth(tokens.get(UserRole.MANAGER)!, { type: 'bearer' }).expect(200);
    const hidden = await db.appointment.findMany({ where: { groupId: first.groupId } });
    expect(hidden).toHaveLength(2);
    expect(hidden.every(r => r.deletedAt !== null)).toBe(true);
    const listed = await http().get(`/appointments?groupId=${first.groupId}`)
      .auth(tokens.get(UserRole.ADMIN)!, { type: 'bearer' }).expect(200);
    expect(listed.body).toEqual([]);
    expect(await db.auditLog.count({ where: { entityId: first.groupId, action: 'appointment.delete' } })).toBe(1);
  });

  it('looks up customer history only in the active shop', async () => {
    const dto = { ...booking(), phone: '3125550199', customerName: 'Guide Customer', note: 'Fictional preference' };
    expect((await create(dto)).status).toBe(201);
    const lookup = await http().get('/appointments/customer-lookup?phone=3125550199')
      .auth(tokens.get(UserRole.EMPLOYEE)!, { type: 'bearer' }).expect(200);
    expect(lookup.body).toEqual({ customerName: dto.customerName, note: dto.note });
    const foreign = (await auth.selectShop(ids.get(UserRole.MANAGER)!, otherShop)).accessToken;
    const absent = await http().get('/appointments/customer-lookup?phone=3125550199')
      .auth(foreign, { type: 'bearer' }).expect(200);
    expect(absent.body).toEqual({ customerName: null, note: null });
  });

  it.each([
    ['2099-02-15T10:00:00-06:00', '2099-02-15T16:00:00.000Z'],
    ['2099-07-15T10:00:00-05:00', '2099-07-15T15:00:00.000Z'],
  ])('preserves explicit Central standard/daylight offsets %s as UTC instants', async (startAt, utc) => {
    const response = await create({ ...booking(), startAt, endAt: new Date(+new Date(startAt) + 45 * 60_000).toISOString() });
    expect(response.status).toBe(201);
    expect(response.body.appointments[0].startAt).toBe(utc);
    const saved = await db.appointment.findUniqueOrThrow({ where: { id: response.body.appointments[0].id } });
    expect(saved.startAt.toISOString()).toBe(utc);
  });
});
