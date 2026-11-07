import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { Server } from 'node:http';
import request from 'supertest';
import { AuditService } from '../audit/audit.service';
import { JwtStrategy } from '../auth/jwt.strategy';
import { SHOP_SCOPED_PRISMA } from '../common/prisma/prisma.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { ShopContextInterceptor } from '../common/shop-context/shop-context.interceptor';
import { StaffColorsService } from '../staff-colors/staff-colors.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// Evaluate the actual explicit base-client where/select intent, not a scoped
// findFirst stub returning a manager regardless of Prisma's shop predicate.
describe('ADMIN global manager management HTTP (memory only)', () => {
  const version = new Date('2026-01-01');
  const row = (
    id: string,
    role: UserRole,
    shopId = 'shop-a',
    status: UserStatus = UserStatus.ACTIVE,
    deletedAt: Date | null = null,
  ) => ({
    id,
    username: id,
    displayName: id,
    role,
    shopId,
    status,
    deletedAt,
    createdAt: version,
    updatedAt: version,
    passwordHash: 'old-hash',
  });
  type Row = ReturnType<typeof row>;
  let rows: Row[];
  let app: INestApplication;
  let server: Server;
  const jwt = new JwtService({ secret: 'memory-test-secret' });
  const record = jest
    .fn<
      ReturnType<AuditService['recordUserManagementChange']>,
      Parameters<AuditService['recordUserManagementChange']>
    >()
    .mockResolvedValue(undefined);
  const update = jest.fn();
  const colorSave = jest.fn();
  const colorPreview = jest.fn();
  const scopedRead = jest.fn(() => {
    throw new Error('Management must use explicit base-client eligibility');
  });
  const matches = (entry: Row, where: Record<string, unknown> = {}): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'OR')
        return (value as Record<string, unknown>[]).some((part) =>
          matches(entry, part),
        );
      return entry[key as keyof Row] === value;
    });
  const project = (entry: Row, select?: Record<string, unknown>) =>
    select
      ? Object.fromEntries(
          Object.keys(select)
            .filter((key) => select[key])
            .map((key) => [key, entry[key as keyof Row]]),
        )
      : { ...entry };
  const findFirst = jest.fn((args: Prisma.UserFindFirstArgs) => {
    const found = rows.find((entry) =>
      matches(entry, args.where as Record<string, unknown>),
    );
    return Promise.resolve(
      found ? project(found, args.select ?? undefined) : null,
    );
  });
  const findMany = jest.fn((args: Prisma.UserFindManyArgs) =>
    Promise.resolve(
      rows
        .filter((entry) =>
          matches(entry, args.where as Record<string, unknown>),
        )
        .map((entry) => project(entry, args.select ?? undefined)),
    ),
  );
  const base = {
    user: { findFirst, findMany, update },
    $queryRaw: jest.fn(() => Promise.resolve([])),
    $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      callback(base),
  };
  const token = (id: string, uv = version.getTime()) =>
    jwt.sign({ sub: id, uv, activeShopId: 'shop-b' });
  const call = (
    method: 'get' | 'patch' | 'delete',
    path: string,
    id = 'admin-b',
  ) => request(server)[method](path).auth(token(id), { type: 'bearer' });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [UsersController],
      providers: [
        UsersService,
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            JWT_ACCESS_SECRET: 'memory-test-secret',
          }),
        },
        { provide: PrismaService, useValue: base },
        {
          provide: SHOP_SCOPED_PRISMA,
          useValue: { user: { findMany: scopedRead } },
        },
        {
          provide: StaffColorsService,
          useValue: {
            get: () => Promise.resolve('#60a5fa'),
            lock: () => Promise.resolve(),
            previewReassignment: colorPreview,
            saveReassignment: colorSave,
          },
        },
        {
          provide: AuditService,
          useValue: {
            createAuditContext: (actorUserId: string) =>
              Promise.resolve({
                actorUserId,
                shopId: 'shop-b',
                actorSnapshot: { id: actorUserId, role: UserRole.ADMIN },
                shopSnapshot: { id: 'shop-b', name: 'B' },
              }),
            recordUserManagementChange: record,
          },
        },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalInterceptors(new ShopContextInterceptor(new Reflector()));
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    colorPreview.mockResolvedValue('#f87171');
    colorSave.mockResolvedValue(undefined);
    rows = [
      row('admin-b', UserRole.ADMIN, 'shop-b'),
      row('employee-b', UserRole.EMPLOYEE, 'shop-b'),
      row('manager-a', UserRole.MANAGER),
      row(
        'inactive-manager-a',
        UserRole.MANAGER,
        'shop-a',
        UserStatus.INACTIVE,
      ),
      row(
        'deleted-manager-a',
        UserRole.MANAGER,
        'shop-a',
        UserStatus.ACTIVE,
        version,
      ),
      row('employee-a', UserRole.EMPLOYEE),
      row('shared-a', UserRole.SHOP_ACCOUNT),
      row('admin-a', UserRole.ADMIN),
    ];
    update.mockImplementation((args: Prisma.UserUpdateArgs) => {
      expect(args.where).toEqual({ id: expect.any(String) as unknown });
      const target = rows.find((entry) => entry.id === args.where.id);
      if (!target) throw new Error('Not found');
      Object.assign(target, args.data, {
        updatedAt: new Date(target.updatedAt.getTime() + 1),
      });
      return Promise.resolve(project(target, args.select ?? undefined));
    });
  });

  it('lists local accounts plus active/inactive global managers once, with safe fields', async () => {
    const response = await call('get', '/users').expect(200);
    const body = response.body as Array<Record<string, unknown>>;
    expect(body.map((entry) => entry.id)).toEqual([
      'admin-b',
      'employee-b',
      'manager-a',
      'inactive-manager-a',
    ]);
    expect(JSON.stringify(body)).not.toMatch(/password|token|old-hash/i);
    expect(scopedRead).not.toHaveBeenCalled();
  });

  it('allows admin to preview then confirm only a local employee color and rejects stale/manual candidates', async () => {
    const preview = await call('get', '/users/employee-b/color-preview').expect(200);
    expect(preview.body as unknown).toMatchObject({ currentColor: '#60a5fa', candidateColor: '#f87171', previewToken: expect.any(String) });
    expect(colorSave).not.toHaveBeenCalled();
    await call('patch', '/users/employee-b/color').send(preview.body).expect(200);
    expect(colorSave).toHaveBeenCalledWith(base, 'shop-b', 'employee-b', '#f87171');
    expect(record).toHaveBeenCalledTimes(1);
    colorSave.mockClear();
    await call('patch', '/users/employee-b/color').send({ ...preview.body, candidateColor: '#000000' }).expect(409);
    await call('get', '/users/employee-b/color-preview?excluded=invalid').expect(400);
    await call('patch', '/users/employee-b/color').send({ currentColor: '#60a5fa', candidateColor: '#f87171' }).expect(400);
    await call('patch', '/users/employee-b/color').send({ currentColor: '#60a5fa' }).expect(400);
    expect(colorSave).not.toHaveBeenCalled();
    for (const id of ['employee-a', 'manager-a', 'admin-b', 'shared-a', 'deleted-manager-a']) {
      await call('get', `/users/${id}/color-preview`).expect(404);
      await call('patch', `/users/${id}/color`).send(preview.body).expect(404);
    }
    expect(colorSave).not.toHaveBeenCalled();
  });

  it.each(['employee-b', 'manager-a', 'shared-a'])(
    '%s cannot read management or mutate users (real JWT and RolesGuard)',
    async (actor) => {
      const before = structuredClone(rows);
      await call('get', '/users', actor).expect(403);
      await call('get', '/users/employee-b/color-preview', actor).expect(403);
      await call('patch', '/users/employee-b/color', actor)
        .send({ currentColor: '#60a5fa', candidateColor: '#f87171' }).expect(403);
      await call('patch', '/users/manager-a/password', actor)
        .send({ newPassword: 'new-password' })
        .expect(403);
      await call('patch', '/users/manager-a/status', actor)
        .send({ status: UserStatus.INACTIVE })
        .expect(403);
      await call('delete', '/users/manager-a', actor).expect(403);
      expect(rows).toEqual(before);
      expect(update).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
      expect(colorSave).not.toHaveBeenCalled();
    },
  );

  it.each(['employee-b', 'manager-a', 'shared-a'])(
    'keeps the existing active service-staff projection for %s',
    async (actor) => {
      const response = await call('get', '/users/staff', actor).expect(200);
      const body = response.body as Array<Record<string, unknown>>;
      expect(body.map((entry) => entry.id)).toEqual([
        'employee-b',
        'manager-a',
      ]);
      expect(JSON.stringify(body)).not.toMatch(
        /password|token|createdAt|updatedAt|shopId/i,
      );
      expect(update).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    },
  );

  it('resets the same foreign manager, keeps identity/home/role/color and expires the old JWT', async () => {
    const oldToken = token('manager-a');
    const response = await call('patch', '/users/manager-a/password')
      .send({ newPassword: 'new-password', shopId: 'shop-c' })
      .expect(200);
    const target = rows.find((entry) => entry.id === 'manager-a')!;
    expect(await bcrypt.compare('new-password', target.passwordHash)).toBe(
      true,
    );
    expect(target).toMatchObject({
      id: 'manager-a',
      shopId: 'shop-a',
      role: UserRole.MANAGER,
    });
    expect(response.body as unknown).toMatchObject({
      id: 'manager-a',
      color: '#60a5fa',
    });
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    await request(server)
      .get('/users/staff')
      .auth(oldToken, { type: 'bearer' })
      .expect(401);
    expect(record).toHaveBeenCalledTimes(1);
    const change = record.mock.calls[0][0] as { afterPayload: unknown };
    expect(change.afterPayload).toMatchObject({
      managementScope: 'global',
      homeShopId: 'shop-a',
      operationShopId: 'shop-b',
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain('new-password');
    expect(JSON.stringify(record.mock.calls)).not.toContain('passwordHash');
    expect(record.mock.calls[0][2]).toBe(base);
  });

  it('enables/disables foreign managers without changing home or role or reassigning appointments', async () => {
    for (const [id, status] of [
      ['manager-a', UserStatus.INACTIVE],
      ['inactive-manager-a', UserStatus.ACTIVE],
    ] as const) {
      const response = await call('patch', `/users/${id}/status`)
        .send({ status })
        .expect(200);
      expect(response.body as unknown).toMatchObject({
        id,
        status,
        shopId: 'shop-a',
        color: '#60a5fa',
      });
      expect(rows.find((entry) => entry.id === id)?.updatedAt.getTime()).toBe(
        version.getTime() + 1,
      );
    }
    // The memory client has no appointment writer: disabling must not invoke one.
    expect(record).toHaveBeenCalledTimes(2);
  });

  it.each(['employee-a', 'shared-a', 'admin-a', 'deleted-manager-a'])(
    'rejects foreign nonmanager/deleted target %s without writes',
    async (id) => {
      const before = structuredClone(rows);
      await call('patch', `/users/${id}/password`)
        .send({ newPassword: 'new-password' })
        .expect(404);
      await call('patch', `/users/${id}/status`)
        .send({ status: UserStatus.INACTIVE })
        .expect(404);
      await call('delete', `/users/${id}`).expect(404);
      expect(rows).toEqual(before);
      expect(update).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    },
  );

  it('keeps the existing password policy and local account status support', async () => {
    await call('patch', '/users/manager-a/password')
      .send({ newPassword: 'short' })
      .expect(400);
    expect(update).not.toHaveBeenCalled();
    await call('patch', '/users/employee-b/status')
      .send({ status: UserStatus.INACTIVE })
      .expect(200);
    expect(rows.find((entry) => entry.id === 'employee-b')?.status).toBe(
      UserStatus.INACTIVE,
    );
  });
});
