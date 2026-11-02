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
  it('rejects managers from admin-only routes', () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => [UserRole.ADMIN]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(() =>
      guard.canActivate(makeContext(UserRole.MANAGER) as any),
    ).toThrow(ForbiddenException);
  });

  it('allows managers on routes that explicitly include them', () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => [UserRole.ADMIN, UserRole.MANAGER]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(makeContext(UserRole.MANAGER) as any)).toBe(true);
  });
});
