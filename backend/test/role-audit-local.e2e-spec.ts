import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { User, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { StaffColorsService } from '../src/staff-colors/staff-colors.service';

// Never run this fixture against the persistent development database.
const isolatedDatabase = 'shop_calendar_role_audit_20261102_agent';
const target = process.env.DATABASE_URL;
const localTarget = target ? new URL(target) : null;
const enabled =
  process.env.RUN_LOCAL_ROLE_AUDIT === '1' &&
  localTarget?.pathname === `/${isolatedDatabase}` &&
  ['localhost', '127.0.0.1'].includes(localTarget.hostname);
const describeIsolated = enabled ? describe : describe.skip;

describeIsolated('Real local role/audit database and HTTP integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let shopId: string;
  let otherShopId: string;
  let manager: User;
  let employee: User;
  let foreignEmployee: User;
  const actors = new Map<UserRole, User>();
  const tokens = new Map<UserRole, string>();
  const password = randomUUID();
  let sequence = 0;

  function booking(past = false) {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + (past ? -10 : 10));
    start.setUTCHours(0, sequence++ * 60, 0, 0);
    return {
      employeeId: manager.id,
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
      phone: '3125551234',
    };
  }

  function api(role: UserRole) {
    return {
      get: (path: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .get(path)
          .auth(tokens.get(role)!, { type: 'bearer' }),
      post: (path: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .post(path)
          .auth(tokens.get(role)!, { type: 'bearer' }),
      patch: (path: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .patch(path)
          .auth(tokens.get(role)!, { type: 'bearer' }),
      delete: (path: string) =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .delete(path)
          .auth(tokens.get(role)!, { type: 'bearer' }),
    };
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    shopId = (await prisma.shop.create({ data: { name: 'Isolated Local' } }))
      .id;
    otherShopId = (
      await prisma.shop.create({ data: { name: 'Isolated Other' } })
    ).id;
    const passwordHash = await bcrypt.hash(password, 4);
    for (const role of Object.values(UserRole)) {
      const user = await prisma.user.create({
        data: {
          username: `isolated-${role}`,
          displayName: `Isolated ${role}`,
          passwordHash,
          role,
          shopId: role === UserRole.MANAGER ? otherShopId : shopId,
        },
      });
      actors.set(role, user);
      const login = await auth.login({ username: user.username, password });
      const selected = await auth.selectShop(user.id, shopId);
      expect(login.user.role).toBe(role);
      tokens.set(role, selected.accessToken);
    }
    manager = actors.get(UserRole.MANAGER)!;
    employee = actors.get(UserRole.EMPLOYEE)!;
    foreignEmployee = await prisma.user.create({
      data: {
        username: 'isolated-foreign-employee',
        displayName: 'Foreign Employee',
        passwordHash,
        shopId: otherShopId,
      },
    });
    await prisma.user.createMany({
      data: [
        {
          username: 'isolated-inactive-manager',
          displayName: 'Inactive Manager',
          passwordHash,
          role: UserRole.MANAGER,
          status: UserStatus.INACTIVE,
          shopId: otherShopId,
        },
        {
          username: 'isolated-deleted-manager',
          displayName: 'Deleted Manager',
          passwordHash,
          role: UserRole.MANAGER,
          deletedAt: new Date(),
          shopId: otherShopId,
        },
      ],
    });
    await app.get(StaffColorsService).initializeMissing();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  it.each(Object.values(UserRole))(
    '%s sees local employees and all active managers, and can assign a foreign manager',
    async (role) => {
      const staff = await api(role).get('/users/staff').expect(200);
      const rows = staff.body as Array<{ id: string }>;
      expect(rows.map((row) => row.id).sort()).toEqual(
        [employee.id, manager.id].sort(),
      );
      const created = await api(role)
        .post('/appointments')
        .send(booking())
        .expect(201);
      const result = created.body as { id: string };
      const saved = await prisma.appointment.findUniqueOrThrow({
        where: { id: result.id },
      });
      expect(saved.shopId).toBe(shopId);
      expect(saved.employeeId).toBe(manager.id);
      expect(saved.price).toBe(0);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: saved.groupId, action: 'appointment.create' },
      });
      expect(audit.actorSnapshot).toMatchObject({
        id: actors.get(role)!.id,
        role,
      });
      expect(audit.shopSnapshot).toMatchObject({ id: shopId });
      expect(audit.afterPayload).not.toBeNull();
    },
  );

  it('rolls back an appointment when PostgreSQL rejects the audit insert', async () => {
    const appointmentsBefore = await prisma.appointment.count();
    const auditsBefore = await prisma.auditLog.count();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION isolated_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'isolated audit failure'; END $$;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER isolated_reject_audit BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION isolated_reject_audit();
    `);
    try {
      await api(UserRole.EMPLOYEE)
        .post('/appointments')
        .send(booking())
        .expect(500);
      expect(await prisma.appointment.count()).toBe(appointmentsBefore);
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER isolated_reject_audit ON audit_logs',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION isolated_reject_audit()');
    }
  });

  it('retains shop-scoped conflicts for the same service manager', async () => {
    const dto = booking();
    await api(UserRole.EMPLOYEE).post('/appointments').send(dto).expect(201);
    await api(UserRole.SHOP_ACCOUNT)
      .post('/appointments')
      .send(dto)
      .expect(409);
    const otherShopToken = await auth.selectShop(manager.id, otherShopId);
    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/appointments')
      .auth(otherShopToken.accessToken, { type: 'bearer' })
      .send(dto)
      .expect(201);
  });

  it.each(Object.values(UserRole))(
    '%s can edit into the past and cancel past appointments; only privileged roles delete/create past',
    async (role) => {
      const past = booking(true);
      const privileged = role === UserRole.ADMIN || role === UserRole.MANAGER;
      await api(role)
        .post('/appointments')
        .send(past)
        .expect(privileged ? 201 : 400);
      const created = await api(role)
        .post('/appointments')
        .send(booking())
        .expect(201);
      const { id } = created.body as { id: string };
      const edit = booking(true);
      await api(role)
        .patch(`/appointments/${id}`)
        .send({
          startAt: edit.startAt,
          endAt: edit.endAt,
        })
        .expect(200);
      await api(role).post(`/appointments/${id}/cancel`).expect(201);
      const cancelled = await prisma.appointment.findUniqueOrThrow({
        where: { id },
      });
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.deletedAt).toBeNull();
      await api(role)
        .delete(`/appointments/${id}`)
        .send({})
        .expect(privileged ? 200 : 403);
    },
  );

  it('enforces manager read-only management and normal-account shop boundaries', async () => {
    await api(UserRole.MANAGER).get('/audit/logs').expect(200);
    await api(UserRole.MANAGER).get('/shops').expect(200);
    await api(UserRole.MANAGER).get('/users').expect(403);
    await api(UserRole.MANAGER)
      .patch(`/users/${employee.id}/password`)
      .send({ newPassword: randomUUID() })
      .expect(403);
    await api(UserRole.MANAGER)
      .patch('/system-settings/calendar-window')
      .send({ startHour: 9, endHour: 18 })
      .expect(403);
    await api(UserRole.EMPLOYEE).get('/audit/logs').expect(403);
    for (const role of [UserRole.EMPLOYEE, UserRole.SHOP_ACCOUNT]) {
      await expect(
        auth.selectShop(actors.get(role)!.id, otherShopId),
      ).rejects.toThrow();
      await api(role)
        .post('/appointments')
        .send({
          ...booking(),
          employeeId: foreignEmployee.id,
        })
        .expect(400);
    }
    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get('/users/staff')
      .expect(401);
  });
});
