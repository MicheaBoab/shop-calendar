import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole, UserStatus } from '@prisma/client';
import { getPendingAssignmentEmployeeUsernameForShop } from '../pending-assignment';

const DEFAULT_ADMIN_HOME_SHOP_ID = 'prosper';

@Injectable()
export class DefaultAdminSeed {
  constructor(private readonly prismaService: PrismaService) {}

  async run() {
    const username = process.env.DEFAULT_ADMIN_USERNAME ?? 'admin';

    const existing = await this.prismaService.user.findFirst({
      where: { username, deletedAt: null },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        status: true,
      },
    });

    const adminUser = existing ?? await this.createDefaultAdmin(username);
    await this.ensurePendingAssignmentEmployeesForAllShops();
    return adminUser;
  }

  private async createDefaultAdmin(username: string) {
    const password = process.env.DEFAULT_ADMIN_PASSWORD ?? 'admin123';
    const passwordHash = await bcrypt.hash(password, 10);

    return this.prismaService.user.create({
      data: {
        shopId: DEFAULT_ADMIN_HOME_SHOP_ID,
        username,
        passwordHash,
        displayName: 'Shop Admin',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        status: true,
      },
    });
  }

  private async ensurePendingAssignmentEmployeesForAllShops() {
    const shops = await this.prismaService.shop.findMany({ select: { id: true } });

    for (const shop of shops) {
      await this.ensurePendingAssignmentEmployee(shop.id);
    }
  }

  private async ensurePendingAssignmentEmployee(shopId: string) {
    const username = getPendingAssignmentEmployeeUsernameForShop(shopId);
    const existing = await this.prismaService.user.findFirst({
      where: { username, deletedAt: null },
      select: { id: true },
    });

    if (existing) {
      return;
    }

    const password = process.env.PENDING_EMPLOYEE_PASSWORD ?? 'pending-assignment-disabled-login';
    const passwordHash = await bcrypt.hash(password, 10);

    await this.prismaService.user.create({
      data: {
        shopId,
        username,
        passwordHash,
        displayName: 'Pending Assignment',
        role: UserRole.EMPLOYEE,
        status: UserStatus.ACTIVE,
      },
    });
  }
}
