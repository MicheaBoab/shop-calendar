import {
  AppointmentStatus,
  Prisma,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ShopScopedPrismaClient } from '../common/prisma/prisma.module';
import { shopContextStorage } from '../common/shop-context/shop-context';
import { StaffColorsService } from '../staff-colors/staff-colors.service';
import { UsersService } from './users.service';
import { AppointmentsService } from '../appointments/appointments.service';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('user removal cross-shop transaction (memory, not a DB atomicity proof)', () => {
  const now = new Date();
  const user = {
    id: 'manager',
    shopId: 'shop-a',
    username: 'manager',
    displayName: 'Alex',
    role: UserRole.MANAGER as UserRole,
    status: UserStatus.ACTIVE as UserStatus,
    createdAt: now,
    updatedAt: now,
    deletedAt: null as Date | null,
  };
  const appointment = (id: string, shopId: string, extra = {}) => ({
    id,
    shopId,
    employeeId: user.id,
    status: AppointmentStatus.SCHEDULED,
    deletedAt: null as Date | null,
    startAt: new Date(now.getTime() + 86400000),
    employeeDisplayName: 'Alex',
    employeeColor: '#60a5fa',
    ...extra,
  });
  let state: {
    user: typeof user;
    appointments: ReturnType<typeof appointment>[];
    audits: Array<{ shopId: string; actorUserId: string }>;
  };
  let missingShop: string | undefined;
  const updateMany = jest.fn();
  const transaction = jest.fn();
  const record = jest.fn();
  let service: UsersService;
  let beforeWriteLock: (() => Promise<void>) | undefined;
  let enumerations: number;
  const remove = (id = user.id) =>
    shopContextStorage.run(
      { shopId: 'shop-a', userId: 'admin', role: UserRole.ADMIN },
      () => service.removeUser(id, 'admin'),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    missingShop = undefined;
    beforeWriteLock = undefined;
    enumerations = 0;
    state = {
      user: { ...user },
      appointments: [
        appointment('a', 'shop-a'),
        appointment('b', 'shop-b'),
        appointment('past', 'shop-b', { startAt: new Date(0) }),
        appointment('cancelled', 'shop-b', {
          status: AppointmentStatus.CANCELLED,
        }),
        appointment('deleted', 'shop-b', { deletedAt: now }),
      ],
      audits: [],
    };
    transaction.mockImplementation(
      async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        const staged: typeof state = structuredClone(state);
        const matches = (
          row: ReturnType<typeof appointment>,
          where: Prisma.AppointmentWhereInput,
        ) => {
          const start = where.startAt;
          if (
            !start ||
            typeof start !== 'object' ||
            !('gt' in start) ||
            !(start.gt instanceof Date)
          ) {
            throw new Error('Expected explicit future cutoff');
          }
          return (
            row.employeeId === where.employeeId &&
            row.status === where.status &&
            row.deletedAt === where.deletedAt &&
            row.startAt > start.gt &&
            (!where.shopId || row.shopId === where.shopId)
          );
        };
        updateMany.mockImplementation(
          (args: Prisma.AppointmentUpdateManyArgs) => {
            if (typeof args.where?.shopId !== 'string')
              throw new Error('Missing shop boundary');
            let count = 0;
            for (const row of staged.appointments) {
              if (matches(row, args.where)) {
                if (typeof args.data.employeeId !== 'string')
                  throw new Error('Invalid pending ID');
                row.employeeId = args.data.employeeId;
                count++;
              }
            }
            return { count };
          },
        );
        const tx = {
          user: {
            findFirst: (args: Prisma.UserFindFirstArgs) => {
              const where = args.where;
              if (where?.id) {
                return where.id === staged.user.id &&
                  where.shopId === staged.user.shopId &&
                  !staged.user.deletedAt
                  ? staged.user
                  : null;
              }
              if (where?.shopId === missingShop) return null;
              if (typeof where?.shopId !== 'string')
                throw new Error('Missing shop boundary');
              expect(where).toEqual({
                shopId: where?.shopId,
                username: `pending_assignment__${where.shopId}`,
                role: UserRole.EMPLOYEE,
                status: UserStatus.ACTIVE,
                deletedAt: null,
              });
              return { id: `pending-${where.shopId}` };
            },
            update: async (args: Prisma.UserUpdateArgs) => {
              expect(args.where).toEqual({ id: user.id, shopId: 'shop-a' });
              await beforeWriteLock?.();
              // Model a fresh READ COMMITTED statement snapshot after waiting.
              staged.appointments = structuredClone(state.appointments);
              staged.user = {
                ...staged.user,
                status: UserStatus.INACTIVE,
                deletedAt: new Date(),
              };
              return staged.user;
            },
          },
          appointment: {
            findMany: (args: Prisma.AppointmentFindManyArgs) => {
              enumerations++;
              expect(args).toEqual({
                where: {
                  employeeId: user.id,
                  status: AppointmentStatus.SCHEDULED,
                  deletedAt: null,
                  startAt: { gt: expect.any(Date) as unknown },
                },
                distinct: ['shopId'],
                select: { shopId: true },
                orderBy: { shopId: 'asc' },
              });
              return [
                ...new Set(
                  staged.appointments
                    .filter((row) => matches(row, args.where ?? {}))
                    .map((row) => row.shopId),
                ),
              ]
                .sort()
                .map((shopId) => ({ shopId }));
            },
            updateMany,
          },
          shop: {
            findUnique: ({ where }: Prisma.ShopFindUniqueArgs) => ({
              id: where.id,
              name: where.id,
            }),
          },
        };
        record.mockImplementation(
          (
            change: Parameters<AuditService['recordUserManagementChange']>[0],
            context: Parameters<AuditService['recordUserManagementChange']>[1],
            writer: unknown,
          ) => {
            expect(writer).toBe(tx);
            expect(context.actorSnapshot).toEqual({
              id: 'admin',
              role: UserRole.ADMIN,
            });
            expect(context.shopSnapshot).toEqual({
              id: context.shopId,
              name: context.shopId,
            });
            expect(JSON.stringify(change)).not.toContain('cancelled');
            expect(change.afterPayload).toEqual(
              expect.objectContaining({
                id: user.id,
                role: staged.user.role,
                status: UserStatus.INACTIVE,
                deletedAt: expect.any(Date) as unknown,
              }),
            );
            staged.audits.push({
              shopId: context.shopId,
              actorUserId: change.actorUserId,
            });
          },
        );
        const result = await callback(
          tx as unknown as Prisma.TransactionClient,
        );
        state = staged;
        return result;
      },
    );
    const audit = {
      createAuditContext: () =>
        Promise.resolve({
          actorUserId: 'admin',
          shopId: 'shop-a',
          actorSnapshot: { id: 'admin', role: UserRole.ADMIN },
          shopSnapshot: { id: 'shop-a', name: 'shop-a' },
        }),
      recordUserManagementChange: record,
    };
    service = new UsersService(
      {} as ShopScopedPrismaClient,
      audit as unknown as AuditService,
      { $transaction: transaction } as unknown as PrismaService,
      {
        get: () => Promise.resolve('#60a5fa'),
      } as unknown as StaffColorsService,
    );
  });

  it('reassigns both stores, preserves snapshots/history and audits correct contexts in one transaction', async () => {
    const untouched = structuredClone(state.appointments.slice(2));
    const result = await remove();
    expect(result.status).toBe(UserStatus.INACTIVE);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(state.appointments.slice(0, 2).map((row) => row.employeeId)).toEqual(
      ['pending-shop-a', 'pending-shop-b'],
    );
    expect(state.appointments.slice(2)).toEqual(untouched);
    for (const row of state.appointments) {
      expect(row.employeeDisplayName).toBe('Alex');
      expect(row.employeeColor).toBe('#60a5fa');
    }
    expect(
      updateMany.mock.calls.map(
        ([args]: [Prisma.AppointmentUpdateManyArgs]) => args,
      ),
    ).toEqual(
      ['shop-a', 'shop-b'].map((shopId) => ({
        where: {
          shopId,
          employeeId: user.id,
          status: AppointmentStatus.SCHEDULED,
          deletedAt: null,
          startAt: { gt: expect.any(Date) as unknown },
        },
        data: {
          employeeId: `pending-${shopId}`,
          employeeDisplayName: 'Alex',
          employeeColor: '#60a5fa',
        },
      })),
    );
    expect(state.audits).toEqual([
      { shopId: 'shop-b', actorUserId: 'admin' },
      { shopId: 'shop-a', actorUserId: 'admin' },
    ]);
  });

  it('second-shop pending failure rejects the single transaction without committing earlier writes', async () => {
    missingShop = 'shop-b';
    const before = structuredClone(state);
    await expect(remove()).rejects.toThrow(
      'Pending assignment employee missing for shop shop-b',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(state).toEqual(before);
  });

  it('ordinary employees only reassign their home store', async () => {
    state.user.role = UserRole.EMPLOYEE;
    await remove();
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(state.appointments[1].employeeId).toBe(user.id);
  });

  it('waits for the eligibility share-lock holder to commit a new shop before enumerating', async () => {
    const waiting = deferred();
    const assignmentCommitted = deferred();
    const query = jest.fn((sql: TemplateStringsArray, ...values: unknown[]) => {
      expect(sql.join('')).toContain('FOR SHARE');
      expect(values).toEqual([user.id, 'shop-c']);
      return Promise.resolve([state.user]);
    });
    const appointments = new AppointmentsService(
      {} as ConstructorParameters<typeof AppointmentsService>[0],
      {} as ConstructorParameters<typeof AppointmentsService>[1],
      {} as ConstructorParameters<typeof AppointmentsService>[2],
      {
        get: () => Promise.resolve('#60a5fa'),
      } as unknown as StaffColorsService,
    );
    // The creation transaction has qualified the manager and retains its
    // share lock until its later assignment commit.
    await shopContextStorage.run(
      { shopId: 'shop-c', userId: 'admin', role: UserRole.ADMIN },
      () =>
        appointments['getEmployeeSnapshot'](user.id, {
          $queryRaw: query,
        } as unknown as Prisma.TransactionClient),
    );
    beforeWriteLock = async () => {
      waiting.resolve();
      await assignmentCommitted.promise;
    };
    const removal = remove();
    await waiting.promise;
    expect(enumerations).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
    // READ COMMITTED's next statement sees the assignment committed while
    // UPDATE waited. An eager shop snapshot would omit this store.
    const concurrent = appointment('concurrent', 'shop-c');
    state.appointments.push(concurrent);
    assignmentCommitted.resolve();
    await removal;
    expect(query).toHaveBeenCalledTimes(1);
    expect(
      state.appointments.find((row) => row.id === 'concurrent')?.employeeId,
    ).toBe('pending-shop-c');
    expect(state.audits).toContainEqual({
      shopId: 'shop-c',
      actorUserId: 'admin',
    });
  });

  it('a qualification read waiting behind deletion sees the new inactive state', async () => {
    const locked = deferred();
    const finishDelete = deferred();
    beforeWriteLock = async () => {
      locked.resolve();
      await finishDelete.promise;
    };
    const removal = remove();
    await locked.promise;
    const query = jest.fn(
      async (sql: TemplateStringsArray, ...values: unknown[]) => {
        expect(sql.join('')).toContain('FOR SHARE');
        expect(sql.join('')).toContain("status::text = 'active'");
        expect(sql.join('')).toContain('deleted_at IS NULL');
        expect(values).toEqual([user.id, 'shop-a']);
        await removal;
        return state.user.status === UserStatus.ACTIVE && !state.user.deletedAt
          ? [state.user]
          : [];
      },
    );
    const appointments = new AppointmentsService(
      {} as ConstructorParameters<typeof AppointmentsService>[0],
      {} as ConstructorParameters<typeof AppointmentsService>[1],
      {} as ConstructorParameters<typeof AppointmentsService>[2],
      {} as StaffColorsService,
    );
    const qualification = shopContextStorage.run(
      { shopId: 'shop-a', userId: 'admin', role: UserRole.ADMIN },
      () =>
        appointments['getEmployeeSnapshot'](user.id, {
          $queryRaw: query,
        } as unknown as Prisma.TransactionClient),
    );
    const rejected = expect(qualification).rejects.toThrow(
      'Selected service staff must be active and eligible',
    );
    finishDelete.resolve();
    await rejected;
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('cannot delete another shop account, the pending system account or self', async () => {
    state.user.shopId = 'shop-b';
    await expect(remove()).rejects.toThrow('User not found');
    state.user.shopId = 'shop-a';
    state.user.username = 'pending_assignment__shop-a';
    await expect(remove()).rejects.toThrow(
      'Pending assignment account cannot be removed',
    );
    await expect(remove('admin')).rejects.toThrow(
      'User cannot remove their own account',
    );
    expect(updateMany).not.toHaveBeenCalled();
  });
});
