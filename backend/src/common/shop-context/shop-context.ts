import { AsyncLocalStorage } from 'node:async_hooks';

export interface ShopContextStore {
  shopId: string;
  userId: string;
  role: string;
}

export const shopContextStorage = new AsyncLocalStorage<ShopContextStore>();

export function getCurrentShopContext(): ShopContextStore | undefined {
  return shopContextStorage.getStore();
}

// Throws instead of silently querying without a shop filter.
export function requireCurrentShopId(): string {
  const store = shopContextStorage.getStore();
  if (!store?.shopId) {
    throw new Error('Shop context is not set for this request. A shop must be selected before this operation.');
  }
  return store.shopId;
}
