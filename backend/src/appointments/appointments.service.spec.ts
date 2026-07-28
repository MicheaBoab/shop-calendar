import { AppointmentStatus } from '@prisma/client';
import { AppointmentsService } from './appointments.service';

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
    appointment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
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
    jest.clearAllMocks();
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
      startAt: '2026-07-28T15:00:00.000Z',
      endAt: '2026-07-28T16:00:00.000Z',
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
      startAt: '2026-07-28T15:00:00.000Z',
      endAt: '2026-07-28T16:00:00.000Z',
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
      startAt: '2026-07-28T15:15:00.000Z',
      endAt: '2026-07-28T15:45:00.000Z',
      phone: '3125551234',
      price: '25.00',
      createdById: 'admin-1',
    });

    expect(result.id).toBe('appt-minute');
  expect(appointmentsEventsService.publishAppointmentsChanged).toHaveBeenCalledWith('admin-1');
    expect(prismaService.appointment.findFirst).toHaveBeenCalled();
    expect(prismaService.appointment.create).toHaveBeenCalled();
  });
});
