import { UserRole } from '@prisma/client';

export const isAdmin = (role: UserRole) => role === UserRole.ADMIN;

export const canSwitchShop = (role: UserRole) =>
  role === UserRole.ADMIN || role === UserRole.MANAGER;

export const isEmployeeLike = (role: UserRole) =>
  role === UserRole.EMPLOYEE || role === UserRole.MANAGER;

export const canCreateAppointment = (role: UserRole) =>
  role === UserRole.ADMIN || role === UserRole.MANAGER;

export const canManageAppointments = (role: UserRole) =>
  role === UserRole.ADMIN || role === UserRole.MANAGER;

export const canCreateManagedUserRole = (role: UserRole) =>
  role === UserRole.EMPLOYEE ||
  role === UserRole.MANAGER ||
  role === UserRole.SHOP_ACCOUNT;
