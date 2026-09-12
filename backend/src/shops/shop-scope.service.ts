import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { canSwitchShop } from '../auth/role-capabilities';

@Injectable()
export class ShopScopeService {
  constructor(private readonly prismaService: PrismaService) {}

  assertAccess(user: { role: UserRole; shopId: string }, targetShopId: string) {
    if (canSwitchShop(user.role)) {
      return;
    }

    if (user.shopId !== targetShopId) {
      throw new ForbiddenException('You do not have access to this shop');
    }
  }

  async assertShopExists(shopId: string) {
    const shop = await this.prismaService.shop.findUnique({
      where: { id: shopId },
    });
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
