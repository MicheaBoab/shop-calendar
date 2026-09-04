import { Module } from '@nestjs/common';
import { ShopsController } from './shops.controller';
import { ShopScopeService } from './shop-scope.service';

@Module({
  controllers: [ShopsController],
  providers: [ShopScopeService],
  exports: [ShopScopeService],
})
export class ShopsModule {}
