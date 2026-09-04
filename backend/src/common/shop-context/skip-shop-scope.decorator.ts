import { SetMetadata } from '@nestjs/common';

// Marks routes that must run before/without an active shop selection
// (e.g. GET /shops, POST /auth/select-shop, POST /auth/logout).
export const SKIP_SHOP_SCOPE_KEY = 'skipShopScope';
export const SkipShopScope = () => SetMetadata(SKIP_SHOP_SCOPE_KEY, true);
