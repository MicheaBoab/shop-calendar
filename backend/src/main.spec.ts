import { runSeedSafely } from './main';
import { DefaultAdminSeed } from './common/seed/default-admin.seed';

describe('runSeedSafely', () => {
  it('does not throw when seed fails due to a missing table', async () => {
    const seedService = {
      run: jest.fn().mockRejectedValue(
        new Error('The table `public.User` does not exist in the current database.'),
      ),
    } as unknown as DefaultAdminSeed;

    await expect(runSeedSafely(seedService)).resolves.toBeUndefined();
    expect(seedService.run).toHaveBeenCalledTimes(1);
  });

  it('resolves normally when seed succeeds', async () => {
    const seedService = {
      run: jest.fn().mockResolvedValue(undefined),
    } as unknown as DefaultAdminSeed;

    await expect(runSeedSafely(seedService)).resolves.toBeUndefined();
    expect(seedService.run).toHaveBeenCalledTimes(1);
  });
});
