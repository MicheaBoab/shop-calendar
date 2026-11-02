import { AppointmentStatus, Prisma, UserRole } from '@prisma/client';
import { AppointmentsService } from './appointments.service';
import { shopContextStorage } from '../common/shop-context/shop-context';

it('waits for new manager eligibility before writing retained group appointments', async () => {
  const now = new Date();
  const member = {
    id: 'appointment-1',
    shopId: 'shop-a',
    employeeId: 'employee',
    groupId: 'group',
    startAt: new Date(now.getTime() + 86400000),
    endAt: new Date(now.getTime() + 90000000),
    phone: '3125550100',
    price: 7000,
    status: AppointmentStatus.SCHEDULED,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  let release!: () => void;
  let signal!: () => void;
  const entered = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const update = jest.fn(() => Promise.resolve(member));
  const create = jest.fn(() =>
    Promise.resolve({ ...member, id: 'appointment-2', employeeId: 'manager' }),
  );
  const query = jest.fn(
    async (sql: TemplateStringsArray, ...values: unknown[]) => {
      expect(sql.join('')).toContain('FOR SHARE');
      expect(values).toEqual(['manager', 'shop-a']);
      signal();
      await gate;
      return [{ id: 'manager', username: 'manager', displayName: 'Sam' }];
    },
  );
  const findFirst = jest
    .fn(() => Promise.resolve<typeof member | null>(null))
    .mockResolvedValueOnce(member);
  const tx = {
    appointment: {
      findFirst,
      findMany: () => Promise.resolve([member]),
      update,
      create,
    },
    user: { findFirst: () => Promise.resolve({ id: 'pending' }) },
    $queryRaw: query,
  };
  const prisma = {
    ...tx,
    $transaction: (
      work: (client: Prisma.TransactionClient) => Promise<unknown>,
    ) => work(tx as unknown as Prisma.TransactionClient),
  };
  const service = new AppointmentsService(
    prisma as unknown as ConstructorParameters<typeof AppointmentsService>[0],
    {
      createAuditContext: () => Promise.resolve({}),
      recordAppointmentChange: () => Promise.resolve(),
    } as unknown as ConstructorParameters<typeof AppointmentsService>[1],
    {
      publishAppointmentsChanged: jest.fn(),
    } as unknown as ConstructorParameters<typeof AppointmentsService>[2],
    {
      get: () => Promise.resolve('#60a5fa'),
    } as unknown as ConstructorParameters<typeof AppointmentsService>[3],
  );
  const updating = shopContextStorage.run(
    { shopId: 'shop-a', userId: 'admin', role: UserRole.ADMIN },
    () =>
      service.updateAppointment(member.id, {
        employeeIds: ['employee', 'manager'],
        partySize: 2,
        updatedById: 'admin',
      }),
  );
  await entered;
  expect(update).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  release();
  await updating;
  expect(update).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1);
});
