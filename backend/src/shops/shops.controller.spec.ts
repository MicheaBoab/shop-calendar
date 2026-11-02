import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../auth/roles.decorator';
import { ShopsController } from './shops.controller';

describe('ShopsController', () => {
  it('allows admins and managers to fetch the shop list', () => {
    const listShopsHandler = Object.getOwnPropertyDescriptor(
      ShopsController.prototype,
      'listShops',
    )?.value as unknown as ShopsController['listShops'];
    const roles = new Reflector().get<UserRole[]>(ROLES_KEY, listShopsHandler);

    expect(roles).toEqual([UserRole.ADMIN, UserRole.MANAGER]);
  });
});
