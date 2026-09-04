import { AppointmentStatus } from '@prisma/client';
import { AppointmentsService } from './appointments.service';
import { requireCurrentShopId } from '../common/shop-context/shop-context';

jest.mock('../common/shop-context/shop-context', () => ({
  requireCurrentShopId: jest.fn(() => 'prosper'),
}));

// Fixed month/day one year ahead so it stays valid for validateTimeNotInPast regardless of when the suite runs.
const futureIso = (hours: number, minutes: number) => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() + 1, 6, 28);
  date.setUTCHours(hours, minutes, 0, 0);
  return date.toISOString();
};

const makeAppointment = (overrides: Record<string, unknown> = {}) => ({
  id: 'appt-1',
  employeeId: 'emp-1',
  startAt: new Date('2026-07-28T15:00:00.000Z'),
  endAt: new Date('2026-07-28T16:00:00.000Z'),
  phone: '3125551234',
  price: 2500,
  customerName: 'Alice',
  serviceName: 'Cut',
  note: 'note',
  status: AppointmentStatus.SCHEDULED,
  createdById: 'admin-1',
  updatedById: 'admin-1',
  createdAt: new Date('2026-07-28T10:00:00.000Z'),
  updatedAt: new Date('2026-07-28T10:30:00.000Z'),
  deletedAt: null,
  ...overrides,
});

describe('AppointmentsService', () => {
  const prismaService = {
    user: {
      findFirst: jest.fn(),
    },
    appointment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    staffColorMap: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prismaService)),
  };

  const auditService = {
    recordAppointmentChange: jest.fn(),
  };

  const appointmentsEventsService = {
    publishAppointmentsChanged: jest.fn(),
  };

  const service = new AppointmentsService(
    prismaService as any,
    auditService as any,
    appointmentsEventsService as any,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    (requireCurrentShopId as jest.Mock).mockReturnValue('prosper');
    prismaService.user.findFirst.mockResolvedValue(null);
    prismaService.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(prismaService),
    );
  });

  it('allows employee to edit another employee appointment and writes full audit payload', async () => {
    const existing = makeAppointment({ id: 'appt-2', employeeId: 'emp-2' });
    const updated = makeAppointment({
      id: 'appt-2',
      employeeId: 'emp-3',
      phone: '3125559999',
      price: 4050,
      customerName: 'Bob',
      updatedById: 'employee-1',
    });

    prismaService.appointment.findFirst
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(null);
    prismaService.appointment.update.mockResolvedValueOnce(updated);

    const result = await service.updateAppointment('appt-2', {
      employeeId: 'emp-3',
      startAt: futureIso(15, 0),
      endAt: futureIso(16, 0),
      phone: '3125559999',
      price: '40.50',
      updatedById: 'employee-1',
    });

    expect(result.employeeId).toBe('emp-3');
    expect(result.phone).toBe('3125559999');
    expect(result.price).toBe('40.50');
    expect(appointmentsEventsService.publishAppointmentsChanged).toHaveBeenCalledWith('employee-1');

    expect(auditService.recordAppointmentChange).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'employee-1',
        action: 'appointment.update',
      }),
    );

    const auditCall = auditService.recordAppointmentChange.mock.calls[0][0];
    expect(auditCall.beforePayload).toEqual(
      expect.objectContaining({
        phone: '3125551234',
        price: '25.00',
        customerName: 'Alice',
      }),
    );
    expect(auditCall.afterPayload).toEqual(
      expect.objectContaining({
        phone: '3125559999',
        price: '40.50',
        customerName: 'Bob',
      }),
    );
  });

    it('finds the latest customer details for an active phone number', async () => {
      prismaService.appointment.findFirst.mockResolvedValue({
        customerName: 'Alice',
        note: 'Prefers morning appointments',
      });

      const result = await service.findCustomerByPhone('3125551234');

      expect(prismaService.appointment.findFirst).toHaveBeenCalledWith({
        where: {
          shopId: 'prosper',
          phone: '3125551234',
          deletedAt: null,
          OR: [{ customerName: { not: null } }, { note: { not: null } }],
        },
        orderBy: { createdAt: 'desc' },
        select: { customerName: true, note: true },
      });
      expect(result).toEqual({
        customerName: 'Alice',
        note: 'Prefers morning appointments',
      });
    });

    it('isolates customer lookup by shop when the active shop context changes', async () => {
      (requireCurrentShopId as jest.Mock).mockReturnValueOnce('shop-a');
      prismaService.appointment.findFirst.mockResolvedValueOnce({
        customerName: 'Alice',
        note: null,
      });

      const resultA = await service.findCustomerByPhone('3125551234');

      expect(prismaService.appointment.findFirst).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ where: expect.objectContaining({ shopId: 'shop-a', phone: '3125551234' }) }),
      );
      expect(resultA).toEqual({ customerName: 'Alice', note: null });

      // Same phone number, different shop: must not see the other shop's customer record.
      (requireCurrentShopId as jest.Mock).mockReturnValueOnce('shop-b');
      prismaService.appointment.findFirst.mockResolvedValueOnce(null);

      const resultB = await service.findCustomerByPhone('3125551234');

      expect(prismaService.appointment.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ where: expect.objectContaining({ shopId: 'shop-b', phone: '3125551234' }) }),
      );
      expect(resultB).toEqual({ customerName: null, note: null });
    });

  it('uses cancel action for employees and delete action for admins with audit logs', async () => {
    const existing = makeAppointment({ id: 'appt-3' });
    const cancelled = makeAppointment({ id: 'appt-3', status: AppointmentStatus.CANCELLED, updatedById: 'employee-2' });
    const deleted = makeAppointment({
      id: 'appt-4',
      status: AppointmentStatus.CANCELLED,
      updatedById: 'admin-9',
      deletedAt: new Date('2026-07-28T12:00:00.000Z'),
    });

    prismaService.appointment.findFirst
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(makeAppointment({ id: 'appt-4' }));
    prismaService.appointment.update
      .mockResolvedValueOnce(cancelled)
      .mockResolvedValueOnce(deleted);

    await service.cancelAppointment('appt-3', 'employee-2');
    await service.deleteAppointment('appt-4', 'admin-9');

    expect(appointmentsEventsService.publishAppointmentsChanged).toHaveBeenNthCalledWith(1, 'employee-2');
    expect(appointmentsEventsService.publishAppointmentsChanged).toHaveBeenNthCalledWith(2, 'admin-9');

    expect(auditService.recordAppointmentChange.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        actorUserId: 'employee-2',
        action: 'appointment.cancel',
      }),
    );
    expect(auditService.recordAppointmentChange.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        actorUserId: 'admin-9',
        action: 'appointment.delete',
      }),
    );

    expect(prismaService.appointment.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        status: AppointmentStatus.CANCELLED,
        updatedById: 'employee-2',
      }),
    );
    expect(prismaService.appointment.update.mock.calls[0][0].data.deletedAt).toBeUndefined();
    expect(prismaService.appointment.update.mock.calls[1][0].data).toEqual(
      expect.objectContaining({
        status: AppointmentStatus.CANCELLED,
        updatedById: 'admin-9',
      }),
    );
    expect(prismaService.appointment.update.mock.calls[1][0].data.deletedAt).toBeInstanceOf(Date);
  });

  it('allows creating appointment when overlapping cancelled appointment exists', async () => {
    const cancelled = makeAppointment({
      id: 'appt-cancelled',
      status: AppointmentStatus.CANCELLED,
    });
    const created = makeAppointment({
      id: 'appt-new',
      createdById: 'admin-1',
      updatedById: 'admin-1',
    });

    prismaService.appointment.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.status === AppointmentStatus.SCHEDULED) {
        return null;
      }

      return cancelled;
    });
    prismaService.appointment.create.mockResolvedValueOnce(created);

    const result = await service.createAppointment({
      employeeId: 'emp-1',
      startAt: futureIso(15, 0),
      endAt: futureIso(16, 0),
      phone: '3125551234',
      price: '25.00',
      createdById: 'admin-1',
    });

    expect(result.id).toBe('appt-new');
  expect(appointmentsEventsService.publishAppointmentsChanged).toHaveBeenCalledWith('admin-1');
    expect(prismaService.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employeeId: 'emp-1',
          status: AppointmentStatus.SCHEDULED,
        }),
      }),
    );
  });

  it('accepts minute-level times when range is valid and there is no conflict', async () => {
    const created = makeAppointment({
      id: 'appt-minute',
      startAt: new Date('2026-07-28T15:15:00.000Z'),
      endAt: new Date('2026-07-28T15:45:00.000Z'),
      createdById: 'admin-1',
      updatedById: 'admin-1',
    });

    prismaService.appointment.findFirst.mockResolvedValueOnce(null);
    prismaService.appointment.create.mockResolvedValueOnce(created);

    const result = await service.createAppointment({
      employeeId: 'emp-1',
      startAt: futureIso(15, 15),
      endAt: futureIso(15, 45),
      phone: '3125551234',
      price: '25.00',
      createdById: 'admin-1',
    });

    expect(result.id).toBe('appt-minute');
  expect(appointmentsEventsService.publishAppointmentsChanged).toHaveBeenCalledWith('admin-1');
    expect(prismaService.appointment.findFirst).toHaveBeenCalled();
    expect(prismaService.appointment.create).toHaveBeenCalled();
  });

  it('rejects creating a single appointment when the employee already has an overlapping appointment', async () => {
    prismaService.appointment.findFirst.mockResolvedValueOnce({ id: 'conflict-1' });

    await expect(
      service.createAppointment({
        employeeId: 'emp-1',
        startAt: futureIso(15, 0),
        endAt: futureIso(16, 0),
        phone: '3125551234',
        price: '25.00',
        createdById: 'admin-1',
      }),
    ).rejects.toThrow('overlaps an existing appointment');

    expect(prismaService.appointment.create).not.toHaveBeenCalled();
    expect(appointmentsEventsService.publishAppointmentsChanged).not.toHaveBeenCalled();
  });

  it('skips overlap checks for pending assignment employee', async () => {
    const created = makeAppointment({ id: 'appt-pending' });
    prismaService.user.findFirst.mockResolvedValueOnce({ id: 'pending-id' });
    prismaService.appointment.create.mockResolvedValueOnce(created);

    const result = await service.createAppointment({
      employeeId: 'pending-id',
      startAt: futureIso(15, 0),
      endAt: futureIso(16, 0),
      phone: '3125551234',
      price: '25.00',
      createdById: 'admin-1',
    });

    expect(result.id).toBe('appt-pending');
    expect(prismaService.appointment.findFirst).not.toHaveBeenCalled();
    expect(prismaService.appointment.create).toHaveBeenCalled();
  });

  it('creates one record per selected employee plus pending fillers sharing a groupId', async () => {
    prismaService.appointment.findFirst.mockResolvedValue(null); // no conflicts
    prismaService.user.findFirst
      .mockResolvedValueOnce({ id: 'pending-id' }) // getPendingAssignmentEmployeeId
      .mockResolvedValueOnce({ displayName: 'Alice', username: 'alice' }) // emp-1 snapshot
      .mockResolvedValueOnce({ displayName: 'Bob', username: 'bob' }) // emp-2 snapshot
      .mockResolvedValueOnce({ displayName: 'Pending', username: 'pending_assignment' }); // pending snapshot

    prismaService.appointment.create
      .mockResolvedValueOnce(makeAppointment({ id: 'appt-1', employeeId: 'emp-1', groupId: 'group-1' }))
      .mockResolvedValueOnce(makeAppointment({ id: 'appt-2', employeeId: 'emp-2', groupId: 'group-1' }))
      .mockResolvedValueOnce(makeAppointment({ id: 'appt-3', employeeId: 'pending-id', groupId: 'group-1' }));

    const result = await service.createAppointment({
      employeeIds: ['emp-1', 'emp-2'],
      partySize: 3,
      startAt: '2026-09-10T15:00:00.000Z',
      endAt: '2026-09-10T16:00:00.000Z',
      phone: '3125551234',
      price: '25.00',
      createdById: 'admin-1',
    } as any);

    expect(result.pendingCount).toBe(1);
    expect(result.appointments).toHaveLength(3);
    expect(result.groupId).toEqual(expect.any(String));
    expect(prismaService.appointment.create).toHaveBeenCalledTimes(3);
    expect(appointmentsEventsService.publishAppointmentsChanged).toHaveBeenCalledWith('admin-1');
  });

  it('rejects group creation when selected employees exceed party size', async () => {
    await expect(
      service.createAppointment({
        employeeIds: ['emp-1', 'emp-2'],
        partySize: 1,
        startAt: '2026-09-10T15:00:00.000Z',
        endAt: '2026-09-10T16:00:00.000Z',
        phone: '3125551234',
        price: '25.00',
        createdById: 'admin-1',
      } as any),
    ).rejects.toThrow('Selected employees cannot exceed party size');
  });

  it('rejects group creation when an employee has a conflicting appointment', async () => {
    prismaService.appointment.findFirst.mockResolvedValueOnce({ id: 'conflict-1' });

    await expect(
      service.createAppointment({
        employeeIds: ['emp-1'],
        partySize: 1,
        startAt: '2026-09-10T15:00:00.000Z',
        endAt: '2026-09-10T16:00:00.000Z',
        phone: '3125551234',
        price: '25.00',
        createdById: 'admin-1',
      } as any),
    ).rejects.toThrow('overlaps an existing appointment');
  });

  it('updates a group by adding an employee and backfilling remaining pending slots', async () => {
    const anchor = makeAppointment({ id: 'appt-1', employeeId: 'emp-1', groupId: 'group-1' });
    const pendingMember = makeAppointment({ id: 'appt-2', employeeId: 'pending-id', groupId: 'group-1' });

    prismaService.appointment.findFirst
      .mockResolvedValueOnce(anchor) // getActiveAppointmentOrThrow
      .mockResolvedValueOnce(null) // conflict check for kept emp-1
      .mockResolvedValueOnce(null); // conflict check for new emp-3
    prismaService.user.findFirst
      .mockResolvedValueOnce({ id: 'pending-id' }) // getPendingAssignmentEmployeeId
      .mockResolvedValueOnce({ displayName: 'Carol', username: 'carol' }); // snapshot for new employee
    prismaService.appointment.findMany.mockResolvedValueOnce([anchor, pendingMember]);

    prismaService.appointment.update
      .mockResolvedValueOnce(makeAppointment({ id: 'appt-1', employeeId: 'emp-1', groupId: 'group-1' }))
      .mockResolvedValueOnce(
        makeAppointment({
          id: 'appt-2',
          employeeId: 'pending-id',
          groupId: 'group-1',
          status: AppointmentStatus.CANCELLED,
          deletedAt: new Date('2026-07-28T12:00:00.000Z'),
        }),
      );
    prismaService.appointment.create.mockResolvedValueOnce(
      makeAppointment({ id: 'appt-3', employeeId: 'emp-3', groupId: 'group-1' }),
    );

    const result = await service.updateAppointment('appt-1', {
      employeeIds: ['emp-1', 'emp-3'],
      partySize: 2,
      startAt: '2026-09-10T15:00:00.000Z',
      endAt: '2026-09-10T16:00:00.000Z',
      updatedById: 'admin-1',
    } as any);

    expect(result.groupId).toBe('group-1');
    expect(result.pendingCount).toBe(0);
    expect(result.appointments.map((appointment: any) => appointment.employeeId).sort()).toEqual([
      'emp-1',
      'emp-3',
    ]);
    expect(appointmentsEventsService.publishAppointmentsChanged).toHaveBeenCalledWith('admin-1');
  });
});
