import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { shopScopeExtension } from './shop-scope.extension';
import { shopContextStorage } from '../shop-context/shop-context';

// Builds a real PrismaClient with the extension attached, terminated by a "stub" extension that
// captures the final args and short-circuits before any network/engine call is made. This lets us
// exercise the actual Prisma extension composition mechanics without a live database.
function buildClientWithStub() {
  let captured: { model?: string; operation: string; args: unknown } | null = null;

  const stub = Prisma.defineExtension({
    name: 'stub-terminal',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args }) {
          captured = { model, operation, args };
          return { __stub: true };
        },
      },
    },
  });

  const adapter = new PrismaPg({ connectionString: 'postgresql://user:pass@127.0.0.1:1/db' });
  const base = new PrismaClient({ adapter });
  const client = base.$extends(shopScopeExtension()).$extends(stub);

  return { client, getCaptured: () => captured };
}

describe('shopScopeExtension', () => {
  it('auto-injects the current shopId into where filters for scoped models', async () => {
    const { client, getCaptured } = buildClientWithStub();

    await shopContextStorage.run({ shopId: 'shop-a', userId: 'u1', role: 'ADMIN' }, async () => {
      await client.user.findMany({ where: { role: 'ADMIN' } });
    });

    expect(getCaptured()).toEqual({
      model: 'User',
      operation: 'findMany',
      args: { where: { role: 'ADMIN', shopId: 'shop-a' } },
    });
  });

  it('overrides a tampered shopId in a where filter with the real context shopId', async () => {
    const { client, getCaptured } = buildClientWithStub();

    await shopContextStorage.run({ shopId: 'shop-a', userId: 'u1', role: 'EMPLOYEE' }, async () => {
      await client.appointment.findFirst({ where: { id: 'appt-1', shopId: 'attacker-shop' } });
    });

    expect(getCaptured()?.args).toEqual({ where: { id: 'appt-1', shopId: 'shop-a' } });
  });

  it('throws instead of running the query unscoped when no shop context is set', async () => {
    const { client } = buildClientWithStub();

    await expect(client.user.findMany({})).rejects.toThrow(
      'Shop context is not set for this request. A shop must be selected before this operation.',
    );
  });

  it('does not touch non-scoped models even without a shop context set', async () => {
    const { client, getCaptured } = buildClientWithStub();

    const result = await client.shop.findMany({ where: { id: 'shop-a' } });

    expect(result).toEqual({ __stub: true });
    expect(getCaptured()).toEqual({
      model: 'Shop',
      operation: 'findMany',
      args: { where: { id: 'shop-a' } },
    });
  });

  it('overrides a tampered shopId in create() data with the real context shopId', async () => {
    const { client, getCaptured } = buildClientWithStub();

    await shopContextStorage.run({ shopId: 'shop-a', userId: 'u1', role: 'ADMIN' }, async () => {
      await client.user.create({ data: { username: 'x', shopId: 'attacker-shop' } });
    });

    expect((getCaptured()?.args as { data: { shopId: string } }).data.shopId).toBe('shop-a');
  });

  it('overrides a tampered shopId in createMany() data (array form) with the real context shopId', async () => {
    const { client, getCaptured } = buildClientWithStub();

    await shopContextStorage.run({ shopId: 'shop-a', userId: 'u1', role: 'ADMIN' }, async () => {
      await client.user.createMany({
        data: [
          { username: 'x', shopId: 'attacker-shop' },
          { username: 'y', shopId: 'another-attacker-shop' },
        ],
      });
    });

    const data = (getCaptured()?.args as { data: { shopId: string }[] }).data;
    expect(data.map((item) => item.shopId)).toEqual(['shop-a', 'shop-a']);
  });

  it('overrides a tampered shopId in createMany() data (single-object form) with the real context shopId', async () => {
    const { client, getCaptured } = buildClientWithStub();

    await shopContextStorage.run({ shopId: 'shop-a', userId: 'u1', role: 'ADMIN' }, async () => {
      await client.user.createMany({ data: { username: 'x', shopId: 'attacker-shop' } as never });
    });

    expect((getCaptured()?.args as { data: { shopId: string } }).data.shopId).toBe('shop-a');
  });
});
