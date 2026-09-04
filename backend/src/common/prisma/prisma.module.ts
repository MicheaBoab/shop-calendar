import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { shopScopeExtension } from './shop-scope.extension';

export const SHOP_SCOPED_PRISMA = Symbol('SHOP_SCOPED_PRISMA');

function createShopScopedClient(prisma: PrismaService) {
  return prisma.$extends(shopScopeExtension());
}

export type ShopScopedPrismaClient = ReturnType<typeof createShopScopedClient>;

@Global()
@Module({
  providers: [
    PrismaService,
    {
      provide: SHOP_SCOPED_PRISMA,
      useFactory: createShopScopedClient,
      inject: [PrismaService],
    },
  ],
  exports: [PrismaService, SHOP_SCOPED_PRISMA],
})
export class PrismaModule {}