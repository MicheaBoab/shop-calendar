import { Prisma } from '@prisma/client';
import { requireCurrentShopId } from '../shop-context/shop-context';

// Models that carry a shopId column and must always be scoped to the current shop.
const SHOP_SCOPED_MODELS = new Set([
  'User',
  'Appointment',
  'StaffColorMap',
  'AuditLog',
  'SystemSetting',
]);

const READ_ACTIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

const WRITE_WHERE_ACTIONS = new Set(['update', 'updateMany', 'delete', 'deleteMany', 'upsert']);

// Backstop only: every shop-scoped service is expected to pass shopId explicitly. This extension
// exists so that a forgotten filter fails closed (scoped to the caller's shop) instead of leaking
// data across shops.
export function shopScopeExtension() {
  return Prisma.defineExtension({
    name: 'shop-scope-extension',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !SHOP_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const shopId = requireCurrentShopId();

          if (READ_ACTIONS.has(operation) || WRITE_WHERE_ACTIONS.has(operation)) {
            const typedArgs = args as { where?: Record<string, unknown> };
            typedArgs.where = { ...(typedArgs.where ?? {}), shopId };
          }

          if (operation === 'upsert') {
            const typedArgs = args as { create?: Record<string, unknown> };
            typedArgs.create = { ...(typedArgs.create ?? {}), shopId };
          }

          if (operation === 'create') {
            const typedArgs = args as { data?: Record<string, unknown> };
            typedArgs.data = { ...(typedArgs.data ?? {}), shopId };
          }

          if (operation === 'createMany') {
            const typedArgs = args as { data?: Record<string, unknown> | Record<string, unknown>[] };
            const data = typedArgs.data;
            typedArgs.data = Array.isArray(data)
              ? data.map((item) => ({ ...item, shopId }))
              : { ...(data ?? {}), shopId };
          }

          return query(args);
        },
      },
    },
  });
}
