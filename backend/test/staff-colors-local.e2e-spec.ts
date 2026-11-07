import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppointmentStatus, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { StaffColorsService } from '../src/staff-colors/staff-colors.service';
import { chooseColor, colorFamily } from '../src/staff-colors/color-palette';
import {
  DEFAULT_PENDING_EMPLOYEE_COLOR,
  getPendingAssignmentEmployeeUsernameForShop,
} from '../src/common/pending-assignment';

const target = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL)
  : null;
const enabled =
  process.env.RUN_LOCAL_STAFF_COLORS === '1' &&
  target?.pathname === '/shop_calendar_colors_20261102_agent' &&
  ['localhost', '127.0.0.1'].includes(target.hostname);

(enabled ? describe : describe.skip)(
  'Isolated PostgreSQL persistent colors + real HTTP',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let colors: StaffColorsService;
    let auth: AuthService;
    let shops: string[];
    let adminId: string;
    let tokens: string[];
    let originalEmployee: string;
    let originalManager: string;
    let originalColor: string;
    const password = randomUUID();
    let sequence = 0;

    type StaffRow = {
      id: string;
      color: string;
      role: UserRole;
      displayName: string;
    };
    const api = () =>
      request(app.getHttpServer() as Parameters<typeof request>[0]);
    const roster = async (shop = 0) => {
      const response = await api()
        .get('/users/staff')
        .auth(tokens[shop], { type: 'bearer' })
        .expect(200);
      return response.body as StaffRow[];
    };
    const create = async (
      role: UserRole,
      shop = 0,
      displayName = 'Same Name',
    ) => {
      const result = await api()
        .post('/users')
        .auth(tokens[shop], { type: 'bearer' })
        .send({
          username: `color-fixture-${sequence++}`,
          displayName,
          role,
          password,
        })
        .expect(201);
      return result.body as StaffRow;
    };

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
      colors = app.get(StaffColorsService);
      auth = app.get(AuthService);
      shops = [];
      for (const name of ['Color Isolated A', 'Color Isolated B']) {
        shops.push((await prisma.shop.create({ data: { name } })).id);
      }
      const passwordHash = await bcrypt.hash(password, 4);
      adminId = (
        await prisma.user.create({
          data: {
            shopId: shops[0],
            username: 'color-admin',
            displayName: 'Admin',
            role: UserRole.ADMIN,
            passwordHash,
          },
        })
      ).id;
      tokens = await Promise.all(
        shops.map(
          async (id) => (await auth.selectShop(adminId, id)).accessToken,
        ),
      );
      originalEmployee = (await create(UserRole.EMPLOYEE)).id;
      originalManager = (await create(UserRole.MANAGER, 1)).id;
      originalColor = (await roster()).find(
        (row) => row.id === originalEmployee,
      )!.color;
    });

    afterAll(async () => {
      if (app) await app.close();
      if (prisma) await prisma.$disconnect();
    });

    it('same-name IDs differ; rename and repeated reads keep the persisted color', async () => {
      const second = await create(UserRole.EMPLOYEE);
      expect(second.color).not.toBe(originalColor);
      const firstThree = (await roster()).filter((row) =>
        [originalEmployee, originalManager, second.id].includes(row.id),
      );
      expect(
        new Set(firstThree.map((row) => colorFamily(row.color))).size,
      ).toBe(3);
      await prisma.user.update({
        where: { id: originalEmployee },
        data: { displayName: 'Renamed' },
      });
      const before = await prisma.staffColorMap.findMany();
      await colors.initializeMissing();
      for (let i = 0; i < 2; i++) {
        expect(
          (await roster()).find((row) => row.id === originalEmployee)?.color,
        ).toBe(originalColor);
      }
      expect(await prisma.staffColorMap.findMany()).toEqual(before);
    });

    it('persists manager colors across shops and new stores, excludes admin/shared/pending', async () => {
      await create(UserRole.MANAGER);
      await create(UserRole.SHOP_ACCOUNT);
      const first = await roster(0);
      const second = await roster(1);
      const managers = first.filter((row) => row.role === UserRole.MANAGER);
      expect(managers).toHaveLength(2);
      expect(new Set(managers.map((row) => row.color)).size).toBe(2);
      for (const manager of managers) {
        expect(second.find((row) => row.id === manager.id)?.color).toBe(
          manager.color,
        );
      }
      expect(
        first.some(
          (row) =>
            row.role === UserRole.ADMIN || row.role === UserRole.SHOP_ACCOUNT,
        ),
      ).toBe(false);
      expect(await prisma.managerColorMap.count()).toBe(2);
      const pending = await prisma.user.create({
        data: {
          shopId: shops[0],
          username: `pending_assignment__${shops[0]}`,
          displayName: 'Pending',
          passwordHash: 'unused',
        },
      });
      await colors.initializeMissing();
      expect((await roster()).find((row) => row.id === pending.id)?.color).toBe(
        DEFAULT_PENDING_EMPLOYEE_COLOR,
      );
      expect(
        await prisma.staffColorMap.count({ where: { userId: pending.id } }),
      ).toBe(0);
      const third = await prisma.shop.create({
        data: { name: 'Color Isolated C' },
      });
      const user = await prisma.user.create({
        data: {
          shopId: third.id,
          username: 'third-employee',
          displayName: 'Third',
          passwordHash: 'unused',
        },
      });
      await colors.initializeMissing();
      const map = await prisma.staffColorMap.findUniqueOrThrow({
        where: { shopId_userId: { shopId: third.id, userId: user.id } },
      });
      expect(managers.map((row) => row.color)).not.toContain(map.color);
      expect(managers.map((row) => colorFamily(row.color))).not.toContain(
        colorFamily(map.color),
      );
    });

    it('uses best available candidate avoiding all managers and local reservations; no reshuffle', async () => {
      const before = await prisma.staffColorMap.findMany();
      const managers = await prisma.managerColorMap.findMany();
      const expected = chooseColor(
        [
          ...managers.map((row) => row.color),
          ...before
            .filter((row) => row.shopId === shops[0])
            .map((row) => row.color),
        ],
        DEFAULT_PENDING_EMPLOYEE_COLOR,
      );
      const created = await create(UserRole.EMPLOYEE);
      expect(created.color).toBe(expected);
      const smallTeam = [
        ...managers,
        ...before.filter((row) => row.shopId === shops[0]),
        created,
      ];
      expect(smallTeam).toHaveLength(5);
      expect(new Set(smallTeam.map((row) => colorFamily(row.color))).size).toBe(
        5,
      );
      for (const row of before) {
        expect(
          await prisma.staffColorMap.findUnique({
            where: {
              shopId_userId: { shopId: row.shopId, userId: row.userId },
            },
          }),
        ).toEqual(row);
      }
    });

    it('serializes concurrent employee and manager HTTP creation without duplicates or deadlock', async () => {
      const before = await prisma.staffColorMap.findMany();
      const created = await Promise.all([
        ...Array.from({ length: 6 }, () => create(UserRole.EMPLOYEE)),
        create(UserRole.MANAGER),
        create(UserRole.MANAGER, 1),
      ]);
      expect(new Set(created.map((row) => row.color)).size).toBe(
        created.length,
      );
      expect(await prisma.managerColorMap.count()).toBe(4);
      for (const row of before) {
        expect(
          await prisma.staffColorMap.findUnique({
            where: {
              shopId_userId: { shopId: row.shopId, userId: row.userId },
            },
          }),
        ).toEqual(row);
      }
    }, 30_000);

    it('new/edited appointment snapshots use roster source; allocation never rewrites old audit payloads', async () => {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() + 20);
      start.setUTCHours(16, 0, 0, 0);
      const result = await api()
        .post('/appointments')
        .auth(tokens[0], { type: 'bearer' })
        .send({
          employeeId: originalManager,
          phone: '3125551234',
          price: '70',
          startAt: start.toISOString(),
          endAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
        })
        .expect(201);
      const saved = await prisma.appointment.findUniqueOrThrow({
        where: { id: (result.body as { id: string }).id },
      });
      expect(saved.employeeColor).toBe(
        (await roster(1)).find((row) => row.id === originalManager)?.color,
      );
      const audits = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
      const managerMaps = await prisma.managerColorMap.findMany();
      const activeEmployeeMaps = await prisma.staffColorMap.findMany({
        where: {
          user: { role: UserRole.EMPLOYEE, status: 'ACTIVE', deletedAt: null },
        },
      });
      const expectedManagerColor = chooseColor(
        [
          ...managerMaps.map((row) => row.color),
          ...activeEmployeeMaps.map((row) => row.color),
        ],
        DEFAULT_PENDING_EMPLOYEE_COLOR,
      );
      expect((await create(UserRole.MANAGER)).color).toBe(expectedManagerColor);
      await colors.initializeMissing();
      for (const audit of audits) {
        expect(
          await prisma.auditLog.findUnique({ where: { id: audit.id } }),
        ).toEqual(audit);
      }
      await api()
        .patch(`/appointments/${saved.id}`)
        .auth(tokens[0], { type: 'bearer' })
        .send({ employeeIds: [originalEmployee], partySize: 1 })
        .expect(200);
      const edited = await prisma.appointment.findFirstOrThrow({
        where: {
          groupId: saved.groupId,
          employeeId: originalEmployee,
          deletedAt: null,
          status: 'SCHEDULED',
        },
      });
      expect(edited.employeeColor).toBe(originalColor);
    });

    it('reassignment updates only the target employee appointment color snapshots and preserves history', async () => {
      const otherEmployee = await create(UserRole.EMPLOYEE);
      const pending = await prisma.user.findFirstOrThrow({
        where: {
          shopId: shops[0],
          username: getPendingAssignmentEmployeeUsernameForShop(shops[0]),
        },
      });
      const deletedAt = new Date();
      const start = new Date();
      start.setUTCDate(start.getUTCDate() + 30);
      start.setUTCHours(16, 0, 0, 0);
      const fixtures = [
        {
          employeeId: originalEmployee,
          status: AppointmentStatus.SCHEDULED,
          startAt: new Date(start.getTime() - 60 * 86_400_000),
          deletedAt: null,
        },
        {
          employeeId: originalEmployee,
          status: AppointmentStatus.COMPLETED,
          startAt: new Date(start.getTime() - 30 * 86_400_000),
          deletedAt: null,
        },
        {
          employeeId: originalEmployee,
          status: AppointmentStatus.CANCELLED,
          startAt: new Date(start.getTime() - 10 * 86_400_000),
          deletedAt: null,
        },
        {
          employeeId: originalEmployee,
          status: AppointmentStatus.SCHEDULED,
          startAt: start,
          deletedAt,
        },
        {
          employeeId: otherEmployee.id,
          status: AppointmentStatus.SCHEDULED,
          startAt: new Date(start.getTime() + 60 * 60_000),
          deletedAt: null,
        },
        {
          employeeId: pending.id,
          status: AppointmentStatus.SCHEDULED,
          startAt: new Date(start.getTime() + 120 * 60_000),
          deletedAt: null,
        },
      ];
      const created = await Promise.all(
        fixtures.map((fixture, index) =>
          prisma.appointment.create({
            data: {
              shopId: shops[0],
              employeeId: fixture.employeeId,
              employeeDisplayName: `Snapshot fixture ${index}`,
              employeeColor:
                fixture.employeeId === pending.id
                  ? DEFAULT_PENDING_EMPLOYEE_COLOR
                  : fixture.employeeId === otherEmployee.id
                    ? otherEmployee.color
                    : originalColor,
              startAt: fixture.startAt,
              endAt: new Date(fixture.startAt.getTime() + 30 * 60_000),
              phone: `312555${String(1000 + index).slice(-4)}`,
              price: 7000 + index,
              status: fixture.status,
              deletedAt: fixture.deletedAt,
              createdById: adminId,
              updatedById: adminId,
              groupId: randomUUID(),
            },
          }),
        ),
      );
      const previousAudits = await prisma.auditLog.findMany();
      const previousAppointments = await prisma.appointment.findMany({
        where: { id: { in: created.map((appointment) => appointment.id) } },
      });

      const preview = await api()
        .get(`/users/${originalEmployee}/color-preview`)
        .auth(tokens[0], { type: 'bearer' })
        .expect(200);
      const response = await api()
        .patch(`/users/${originalEmployee}/color`)
        .auth(tokens[0], { type: 'bearer' })
        .send(preview.body)
        .expect(200);
      const newColor = (response.body as { color: string }).color;
      expect(newColor).not.toBe(originalColor);

      const updatedAppointments = await prisma.appointment.findMany({
        where: { id: { in: created.map((appointment) => appointment.id) } },
      });
      for (const before of previousAppointments) {
        const after = updatedAppointments.find(
          (appointment) => appointment.id === before.id,
        )!;
        if (before.employeeId === originalEmployee) {
          expect(after.employeeColor).toBe(newColor);
          expect({ ...after, employeeColor: before.employeeColor }).toEqual(
            before,
          );
        } else {
          expect(after).toEqual(before);
        }
      }
      for (const audit of previousAudits) {
        expect(
          await prisma.auditLog.findUnique({ where: { id: audit.id } }),
        ).toEqual(audit);
      }
    });

    it('persists 100 finite distinct employee colors in a real isolated store', async () => {
      const large = await prisma.shop.create({
        data: { name: 'Color Isolated 100' },
      });
      await prisma.user.createMany({
        data: Array.from({ length: 100 }, (_, i) => ({
          shopId: large.id,
          username: `hundred-${i}`,
          displayName: 'Same Name',
          passwordHash: 'unused',
        })),
      });
      await colors.initializeMissing();
      const maps = await prisma.staffColorMap.findMany({
        where: { shopId: large.id },
      });
      expect(maps).toHaveLength(100);
      expect(new Set(maps.map((row) => row.color)).size).toBe(100);
      expect(maps.every((row) => /^#[0-9a-f]{6}$/.test(row.color))).toBe(true);
    }, 120_000);

    it('a fresh color service instance reads the same persisted manager/employee values', async () => {
      const fresh = new StaffColorsService(prisma);
      await fresh.initializeMissing();
      const employee = await prisma.user.findUniqueOrThrow({
        where: { id: originalEmployee },
      });
      expect(await fresh.get(employee, shops[0])).toBe(originalColor);
      const manager = await prisma.user.findUniqueOrThrow({
        where: { id: originalManager },
      });
      expect(await fresh.get(manager, shops[0])).toBe(
        await fresh.get(manager, shops[1]),
      );
    }, 120_000);
  },
);
