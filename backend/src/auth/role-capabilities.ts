import { UserRole } from '@prisma/client';

export const isAdmin = (role: UserRole) => role === UserRole.ADMIN;

export const canSwitchShop = (role: UserRole) =>
  role === UserRole.ADMIN || role === UserRole.MULTI_SHOP_EMPLOYEE;

export const isEmployeeLike = (role: UserRole) =>
  role === UserRole.EMPLOYEE || role === UserRole.MULTI_SHOP_EMPLOYEE;

export const canCreateManagedUserRole = (role: UserRole) =>
  role === UserRole.EMPLOYEE || role === UserRole.MULTI_SHOP_EMPLOYEE;
