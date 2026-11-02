import {
  AppointmentStatus,
  Prisma,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { UsersService } from './users.service';
import { AuditService } from '../audit/audit.service';
import { StaffColorsService } from '../staff-colors/staff-colors.service';
import { requireCurrentShopId } from '../common/shop-context/shop-context';
import { getPendingAssignmentEmployeeUsernameForShop } from '../common/pending-assignment';

jest.mock('../common/shop-context/shop-context', () => ({
  requireCurrentShopId: jest.fn(() => 'prosper'),
}));

describe('UsersService staff color mapping', () => {
  let service: UsersService;
  type AsyncMock<Args extends unknown[] = []> = jest.Mock<
    Promise<unknown>,
    Args
  >;
  const asyncMock = <Args extends unknown[] = []>() =>
    jest.fn<Promise<unknown>, Args>();
  type PrismaMock = {
    $transaction: jest.Mock<
      Promise<unknown>,
      [(tx: unknown) => Promise<unknown>]
    >;
    user: {
      findMany: AsyncMock<[Prisma.UserFindManyArgs]>;
      findFirst: AsyncMock<[Prisma.UserFindFirstArgs]>;
      create: AsyncMock<[Prisma.UserCreateArgs]>;
      update: AsyncMock<[Prisma.UserUpdateArgs]>;
    };
    appointment: {
      findMany: AsyncMock;
      updateMany: AsyncMock<[Prisma.AppointmentUpdateManyArgs]>;
    };
    staffColorMap: {
      findUnique: AsyncMock;
      create: AsyncMock;
      upsert: AsyncMock;
    };
  };
  let prismaService: PrismaMock;
  let auditService: {
    createAuditContext: jest.MockedFunction<AuditService['createAuditContext']>;
    recordUserManagementChange: jest.MockedFunction<
      AuditService['recordUserManagementChange']
    >;
  };
  let basePrismaService: {
    $transaction: PrismaMock['$transaction'];
    user: {
      findMany: AsyncMock<[Prisma.UserFindManyArgs]>;
      findFirst: PrismaMock['user']['findFirst'];
    };
    shop: { findUnique: AsyncMock };
  };
  let staffColors: {
    lock: jest.MockedFunction<StaffColorsService['lock']>;
    allocate: jest.MockedFunction<StaffColorsService['allocate']>;
    get: jest.MockedFunction<StaffColorsService['get']>;
  };

  beforeEach(() => {
    prismaService = {
      $transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) =>
        callback(prismaService),
      ),
      user: {
        findMany: asyncMock<[Prisma.UserFindManyArgs]>(),
        findFirst: asyncMock<[Prisma.UserFindFirstArgs]>(),
        create: asyncMock<[Prisma.UserCreateArgs]>(),
        update: asyncMock<[Prisma.UserUpdateArgs]>(),
      },
      appointment: {
        findMany: asyncMock(),
        updateMany: asyncMock<[Prisma.AppointmentUpdateManyArgs]>(),
      },
      staffColorMap: {
        findUnique: asyncMock(),
        create: asyncMock(),
        upsert: asyncMock(),
      },
    };

    auditService = {
      createAuditContext: jest.fn((actorUserId: string) =>
        Promise.resolve({
          actorUserId,
          shopId: 'prosper',
          actorSnapshot: { id: actorUserId, role: 'ADMIN' },
          shopSnapshot: { id: 'prosper', name: 'Prosper' },
        }),
      ),
      recordUserManagementChange: jest
        .fn<
          ReturnType<AuditService['recordUserManagementChange']>,
          Parameters<AuditService['recordUserManagementChange']>
        >()
        .mockResolvedValue(undefined),
    };

    basePrismaService = {
      $transaction: prismaService.$transaction,
      user: {
        findMany: asyncMock<[Prisma.UserFindManyArgs]>(),
        findFirst: prismaService.user.findFirst,
      },
      shop: { findUnique: asyncMock() },
    };

    staffColors = {
      lock: jest
        .fn<
          ReturnType<StaffColorsService['lock']>,
          Parameters<StaffColorsService['lock']>
        >()
        .mockResolvedValue(undefined),
      allocate: jest.fn<
        ReturnType<StaffColorsService['allocate']>,
        Parameters<StaffColorsService['allocate']>
      >((_tx, user) =>
        Promise.resolve(
          user.role === UserRole.SHOP_ACCOUNT ? undefined : '#60a5fa',
        ),
      ),
      get: jest
        .fn<
          ReturnType<StaffColorsService['get']>,
          Parameters<StaffColorsService['get']>
        >()
        .mockResolvedValue('#60a5fa'),
    };
    service = new UsersService(
      prismaService as unknown as ConstructorParameters<typeof UsersService>[0],
      auditService as unknown as AuditService,
      basePrismaService as unknown as ConstructorParameters<
        typeof UsersService
      >[2],
      staffColors as unknown as StaffColorsService,
    );
    (requireCurrentShopId as jest.Mock).mockReturnValue('prosper');
  });

  it('ignores a caller-supplied shopId and always creates the user under the active shop context', async () => {
    prismaService.staffColorMap.findUnique.mockResolvedValue(null);
    prismaService.user.create.mockResolvedValue({
      id: 'user-9',
      username: 'bob',
      displayName: 'Bob',
      role: UserRole.EMPLOYEE,
      status: UserStatus.ACTIVE,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    // Structural extra field simulates a tampered payload, without weakening types.
    const maliciousDto = {
      username: 'bob',
      password: 'secretpw',
      role: UserRole.EMPLOYEE,
      shopId: 'attacker-shop',
    };

    await service.createUser(maliciousDto, 'admin-1');

    expect(prismaService.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shopId: 'prosper' }) as unknown,
      }),
    );
    expect(prismaService.user.create.mock.calls[0][0].data.shopId).not.toBe(
      'attacker-shop',
    );
    const auditPayload =
      auditService.recordUserManagementChange.mock.calls[0][0].afterPayload;
    expect(auditPayload).not.toHaveProperty('passwordHash');
    expect(auditPayload).not.toHaveProperty('password');
    expect(auditPayload).not.toHaveProperty('token');
  });

  it('resolves the pending-assignment employee scoped to the current shop when removing a user', async () => {
    (requireCurrentShopId as jest.Mock).mockReturnValue('shop-b');
    const existing = {
      id: 'emp-1',
      username: 'carol',
      displayName: 'Carol',
      role: UserRole.EMPLOYEE,
      status: UserStatus.ACTIVE,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
    };

    prismaService.user.findFirst
      .mockResolvedValueOnce(existing) // ensureUserExists
      .mockResolvedValueOnce({ id: 'pending-shop-b' }); // pending-assignment lookup
    prismaService.user.update.mockResolvedValueOnce({
      ...existing,
      status: UserStatus.INACTIVE,
      deletedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    prismaService.appointment.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaService.staffColorMap.findUnique.mockResolvedValue(null);

    await service.removeUser('emp-1', 'admin-1');

    const pendingLookupArgs = prismaService.user.findFirst.mock.calls[1][0];
    expect(pendingLookupArgs.where?.username).toBe(
      getPendingAssignmentEmployeeUsernameForShop('shop-b'),
    );
    expect(pendingLookupArgs.where?.username).not.toBe(
      getPendingAssignmentEmployeeUsernameForShop('prosper'),
    );
  });

  it('returns the persistent identity allocator result', async () => {
    staffColors.allocate.mockResolvedValue('#123456');
    prismaService.staffColorMap.findUnique.mockResolvedValue({
      color: '#123456',
    });
    prismaService.user.create.mockResolvedValue({
      id: 'user-1',
      username: 'alice',
      displayName: 'Alice',
      role: UserRole.EMPLOYEE,
      status: UserStatus.ACTIVE,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    });

    const created = await service.createUser(
      {
        username: 'alice',
        password: 'password123',
        displayName: 'Alice',
        role: UserRole.EMPLOYEE,
      },
      'admin-1',
    );

    expect('color' in created && created.color).toBe('#123456');
    expect(prismaService.staffColorMap.upsert).not.toHaveBeenCalled();
  });

  it('delegates creation to the locked identity allocator', async () => {
    prismaService.staffColorMap.findUnique.mockResolvedValue(null);
    prismaService.user.create.mockResolvedValue({
      id: 'user-2',
      username: 'alice',
      displayName: 'Alice',
      role: UserRole.EMPLOYEE,
      status: UserStatus.ACTIVE,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    });

    const created = await service.createUser(
      {
        username: 'alice',
        password: 'password123',
        displayName: 'Alice',
        role: UserRole.EMPLOYEE,
      },
      'admin-1',
    );

    expect('color' in created && created.color).toBe('#60a5fa');
    expect(staffColors.lock).toHaveBeenCalledWith(prismaService, 'prosper');
    expect(staffColors.allocate).toHaveBeenCalledWith(
      prismaService,
      expect.objectContaining({ id: 'user-2', role: UserRole.EMPLOYEE }),
      'prosper',
    );
  });

  it('allows admins to create manager accounts', async () => {
    prismaService.staffColorMap.findUnique.mockResolvedValue(null);
    prismaService.user.create.mockResolvedValue({
      id: 'user-3',
      username: 'manager',
      displayName: 'Manager',
      role: UserRole.MANAGER,
      status: UserStatus.ACTIVE,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    });

    const created = await service.createUser(
      {
        username: 'manager',
        password: 'password123',
        displayName: 'Manager',
        role: UserRole.MANAGER,
      },
      'admin-1',
    );

    expect(prismaService.user.create.mock.calls[0][0].data.role).toBe(
      UserRole.MANAGER,
    );
    expect(created.role).toBe(UserRole.MANAGER);
  });

  it('lists local employees and active managers across shops without shop accounts', async () => {
    basePrismaService.user.findMany.mockResolvedValue([
      {
        id: 'manager-a',
        username: 'a',
        displayName: 'Manager A',
        role: UserRole.MANAGER,
        status: UserStatus.ACTIVE,
      },
      {
        id: 'employee-a',
        username: 'e',
        displayName: 'Employee A',
        role: UserRole.EMPLOYEE,
        status: UserStatus.ACTIVE,
      },
    ]);
    prismaService.staffColorMap.findUnique.mockResolvedValue(null);

    const result = await service.listServiceStaff();

    expect(basePrismaService.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: UserStatus.ACTIVE,
          deletedAt: null,
          OR: [
            { shopId: 'prosper', role: UserRole.EMPLOYEE },
            { role: UserRole.MANAGER },
          ],
        }) as unknown,
      }),
    );
    expect(result.map((user) => user.role)).toEqual([
      UserRole.EMPLOYEE,
      UserRole.MANAGER,
    ]);
    expect(result.some((user) => user.role === UserRole.SHOP_ACCOUNT)).toBe(
      false,
    );
  });

  it.each([
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.EMPLOYEE,
    UserRole.SHOP_ACCOUNT,
  ])(
    'includes all active managers in the service-staff roster for %s',
    async () => {
      basePrismaService.user.findMany.mockResolvedValue([]);

      await service.listServiceStaff();

      expect(basePrismaService.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { shopId: 'prosper', role: UserRole.EMPLOYEE },
              { role: UserRole.MANAGER },
            ],
          }) as unknown,
        }),
      );
    },
  );

  it('does not create a staff color mapping for a shared shop account', async () => {
    prismaService.user.create.mockResolvedValue({
      id: 'shared-1',
      username: 'shop',
      displayName: 'Shop Login',
      role: UserRole.SHOP_ACCOUNT,
      status: UserStatus.ACTIVE,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    });

    await service.createUser(
      {
        username: 'shop',
        password: 'password123',
        displayName: 'Shop Login',
        role: UserRole.SHOP_ACCOUNT,
      },
      'admin-1',
    );

    expect(prismaService.staffColorMap.findUnique).not.toHaveBeenCalled();
    expect(prismaService.staffColorMap.create).not.toHaveBeenCalled();
  });

  it('reassigns only future appointments to pending assignment and leaves historical appointments untouched', async () => {
    const now = new Date('2026-08-06T12:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    prismaService.user.findFirst.mockResolvedValueOnce({
      id: 'employee-1',
      username: 'alice',
      displayName: 'Alice',
      role: UserRole.EMPLOYEE,
      status: UserStatus.ACTIVE,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      deletedAt: null,
    });
    prismaService.user.findFirst.mockResolvedValueOnce({
      id: 'pending-id',
      username: 'pending_assignment',
      displayName: 'Pending Assignment',
      role: UserRole.EMPLOYEE,
      status: UserStatus.ACTIVE,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      deletedAt: null,
    });
    prismaService.user.update.mockResolvedValue({
      id: 'employee-1',
      username: 'alice',
      displayName: 'Alice',
      role: UserRole.EMPLOYEE,
      status: UserStatus.INACTIVE,
      updatedAt: now,
      deletedAt: now,
    });

    await service.removeUser('employee-1', 'admin-1');

    expect(prismaService.appointment.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaService.appointment.updateMany).toHaveBeenCalledWith({
      where: {
        shopId: 'prosper',
        employeeId: 'employee-1',
        status: AppointmentStatus.SCHEDULED,
        deletedAt: null,
        startAt: { gt: now },
      },
      data: expect.objectContaining({
        employeeId: 'pending-id',
        employeeDisplayName: 'Alice',
        employeeColor: '#60a5fa',
      }) as unknown,
    });

    jest.useRealTimers();
  });
});
