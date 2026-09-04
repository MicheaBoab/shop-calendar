import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SkipShopScope } from '../common/shop-context/skip-shop-scope.decorator';
import { ShopScopeService } from './shop-scope.service';

@Controller('shops')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShopsController {
  constructor(private readonly shopScopeService: ShopScopeService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @SkipShopScope()
  listShops() {
    return this.shopScopeService.listShops();
  }
}
