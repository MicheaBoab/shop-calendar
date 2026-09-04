import { ForbiddenException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  username: 'alice',
  passwordHash: 'hashed',
  displayName: 'Alice',
  role: UserRole.EMPLOYEE,
  status: UserStatus.ACTIVE,
  shopId: 'shop-a',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
  ...overrides,
});

describe('AuthService', () => {
  const prismaService = {
    user: { findFirst: jest.fn() },
  };

  const jwtService = {
    sign: jest.fn(() => 'signed-token'),
    verifyAsync: jest.fn(),
  };

  const configService = {
    get: jest.fn((_key: string, fallback?: string) => fallback),
  };

  const shopScopeService = {
    assertAccess: jest.fn(),
    assertShopExists: jest.fn(),
  };

  const service = new AuthService(
    prismaService as any,
    jwtService as any,
    configService as any,
    shopScopeService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    shopScopeService.assertShopExists.mockResolvedValue({ id: 'shop-b', name: 'Shop B' });
  });

  it('requires shop selection when an admin logs in', async () => {
    prismaService.user.findFirst.mockResolvedValueOnce(makeUser({ role: UserRole.ADMIN, shopId: 'shop-a' }));

    const result = await service.login({ username: 'admin', password: 'secret' });

    expect(result.needsShopSelection).toBe(true);
    expect(result.activeShopId).toBeNull();
  });

  it('logs an employee straight into their own shop without needing selection', async () => {
    prismaService.user.findFirst.mockResolvedValueOnce(makeUser({ role: UserRole.EMPLOYEE, shopId: 'shop-a' }));

    const result = await service.login({ username: 'alice', password: 'secret' });

    expect(result.needsShopSelection).toBe(false);
    expect(result.activeShopId).toBe('shop-a');
  });

  it('allows an admin to switch to a different shop', async () => {
    prismaService.user.findFirst.mockResolvedValueOnce(makeUser({ role: UserRole.ADMIN, shopId: 'shop-a' }));

    const result = await service.selectShop('user-1', 'shop-b');

    expect(shopScopeService.assertAccess).toHaveBeenCalledWith(
      { role: UserRole.ADMIN, shopId: 'shop-a' },
      'shop-b',
    );
    expect(shopScopeService.assertShopExists).toHaveBeenCalledWith('shop-b');
    expect(result.activeShopId).toBe('shop-b');
  });

  it('allows an employee to select their own shop', async () => {
    prismaService.user.findFirst.mockResolvedValueOnce(makeUser({ role: UserRole.EMPLOYEE, shopId: 'shop-a' }));
    shopScopeService.assertShopExists.mockResolvedValueOnce({ id: 'shop-a', name: 'Shop A' });

    const result = await service.selectShop('user-1', 'shop-a');

    expect(shopScopeService.assertAccess).toHaveBeenCalledWith(
      { role: UserRole.EMPLOYEE, shopId: 'shop-a' },
      'shop-a',
    );
    expect(result.activeShopId).toBe('shop-a');
  });

  it('forbids an employee from selecting a different shop', async () => {
    prismaService.user.findFirst.mockResolvedValueOnce(makeUser({ role: UserRole.EMPLOYEE, shopId: 'shop-a' }));
    shopScopeService.assertAccess.mockImplementationOnce(() => {
      throw new ForbiddenException('You do not have access to this shop');
    });

    await expect(service.selectShop('user-1', 'shop-b')).rejects.toThrow(ForbiddenException);
    expect(shopScopeService.assertShopExists).not.toHaveBeenCalled();
  });
});
