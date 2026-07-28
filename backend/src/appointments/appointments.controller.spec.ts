import { UserRole } from '@prisma/client';
import { AppointmentsController } from './appointments.controller';

describe('AppointmentsController delete behavior', () => {
  const appointmentsService = {
    deleteAppointment: jest.fn(),
    cancelAppointment: jest.fn(),
  };

  const appointmentsEventsService = {
    watchAppointmentsChanged: jest.fn(),
  };

  const jwtService = {
    verifyAsync: jest.fn(),
  };

  const configService = {
    get: jest.fn(),
  };

  const prismaService = {
    user: {
      findFirst: jest.fn(),
    },
  };

  const controller = new AppointmentsController(
    appointmentsService as any,
    appointmentsEventsService as any,
    jwtService as any,
    configService as any,
    prismaService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes employee DELETE to cancel', async () => {
    appointmentsService.cancelAppointment.mockResolvedValue({ success: true, id: 'appt-1' });

    const result = await controller.deleteAppointment(
      'appt-1',
      {},
      {
        user: {
          sub: 'employee-1',
          username: 'employee',
          role: UserRole.EMPLOYEE,
        },
      } as any,
    );

    expect(appointmentsService.cancelAppointment).toHaveBeenCalledWith('appt-1', 'employee-1');
    expect(appointmentsService.deleteAppointment).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, id: 'appt-1' });
  });

  it('routes admin DELETE to delete', async () => {
    appointmentsService.deleteAppointment.mockResolvedValue({ success: true, id: 'appt-2' });

    const result = await controller.deleteAppointment(
      'appt-2',
      {},
      {
        user: {
          sub: 'admin-1',
          username: 'admin',
          role: UserRole.ADMIN,
        },
      } as any,
    );

    expect(appointmentsService.deleteAppointment).toHaveBeenCalledWith('appt-2', 'admin-1');
    expect(appointmentsService.cancelAppointment).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, id: 'appt-2' });
  });
});
