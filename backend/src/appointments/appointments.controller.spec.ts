import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AppointmentsController } from './appointments.controller';
import { ROLES_KEY } from '../auth/roles.decorator';

describe('AppointmentsController permissions and cancel/delete routes', () => {
  const appointmentsService = {
    deleteAppointment: jest.fn(),
    cancelAppointment: jest.fn(),
    createAppointment: jest.fn(),
  };
  const controller = new AppointmentsController(
    appointmentsService as unknown as ConstructorParameters<
      typeof AppointmentsController
    >[0],
    {} as ConstructorParameters<typeof AppointmentsController>[1],
  );

  beforeEach(() => jest.clearAllMocks());

  const request = (role: UserRole) =>
    ({
      user: { sub: 'user-1', username: 'login', role },
    }) as Parameters<AppointmentsController['cancelAppointment']>[1];

  it.each([UserRole.EMPLOYEE, UserRole.SHOP_ACCOUNT])(
    'rejects legacy DELETE for %s with 403 rather than silently cancelling',
    (role) => {
      expect(() =>
        controller.deleteAppointment('appt-1', {}, request(role)),
      ).toThrow(ForbiddenException);
      expect(appointmentsService.cancelAppointment).not.toHaveBeenCalled();
      expect(appointmentsService.deleteAppointment).not.toHaveBeenCalled();
    },
  );

  it.each([UserRole.ADMIN, UserRole.MANAGER])(
    'uses DELETE only for soft deletion for %s',
    async (role) => {
      appointmentsService.deleteAppointment.mockResolvedValue({
        success: true,
        id: 'appt-1',
      });

      await controller.deleteAppointment('appt-1', {}, request(role));

      expect(appointmentsService.deleteAppointment).toHaveBeenCalledWith(
        'appt-1',
        'user-1',
      );
      expect(appointmentsService.cancelAppointment).not.toHaveBeenCalled();
    },
  );

  it.each(Object.values(UserRole))(
    'allows %s to use the explicit cancel route',
    async (role) => {
      appointmentsService.cancelAppointment.mockResolvedValue({
        success: true,
        id: 'appt-1',
      });

      await controller.cancelAppointment('appt-1', request(role));

      expect(appointmentsService.cancelAppointment).toHaveBeenCalledWith(
        'appt-1',
        'user-1',
      );
    },
  );

  it('allows every appointment role to create, with past gating in the service', () => {
    const handler = Object.getOwnPropertyDescriptor(
      AppointmentsController.prototype,
      'createAppointment',
    )?.value as unknown as AppointmentsController['createAppointment'];
    expect(new Reflector().get<UserRole[]>(ROLES_KEY, handler)).toEqual([
      UserRole.ADMIN,
      UserRole.MANAGER,
      UserRole.EMPLOYEE,
      UserRole.SHOP_ACCOUNT,
    ]);
  });
});
