import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class ShopScopeService {
  constructor(private readonly prismaService: PrismaService) {}

  // Admins may access any shop; employees are locked to their own home shop.
  assertAccess(user: { role: UserRole; shopId: string }, targetShopId: string) {
    if (user.role === UserRole.ADMIN) {
      return;
    }

    if (user.shopId !== targetShopId) {
      throw new ForbiddenException('You do not have access to this shop');
    }
  }

  async assertShopExists(shopId: string) {
    const shop = await this.prismaService.shop.findUnique({ where: { id: shopId } });
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }

    return shop;
  }

  listShops() {
    return this.prismaService.shop.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}
