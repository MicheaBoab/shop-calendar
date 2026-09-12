import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';

const makeContext = (role: UserRole) => ({
  getHandler: jest.fn(),
  getClass: jest.fn(),
  switchToHttp: () => ({
    getRequest: () => ({ user: { sub: 'user-1', username: 'user', role } }),
  }),
});

describe('RolesGuard', () => {
  it('rejects multi-shop employees from admin-only routes', () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => [UserRole.ADMIN]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(() =>
      guard.canActivate(makeContext(UserRole.MULTI_SHOP_EMPLOYEE) as any),
    ).toThrow(ForbiddenException);
  });

  it('allows multi-shop employees on routes that explicitly include them', () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => [
        UserRole.ADMIN,
        UserRole.MULTI_SHOP_EMPLOYEE,
      ]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(
      guard.canActivate(makeContext(UserRole.MULTI_SHOP_EMPLOYEE) as any),
    ).toBe(true);
  });
});
