import { BadRequestException } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';

jest.mock('../common/shop-context/shop-context', () => ({
  requireCurrentShopId: jest.fn(() => 'prosper'),
}));

describe('SystemSettingsService', () => {
  it('returns fallback defaults when no record exists', async () => {
    const prismaMock = {
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const service = new SystemSettingsService(prismaMock as any);

    await expect(service.getCalendarWindow()).resolves.toEqual({
      slotMinTime: '10:00:00',
      slotMaxTime: '23:00:00',
    });
  });

  it('rejects ranges where start is not earlier than end', async () => {
    const prismaMock = {
      systemSetting: {
        upsert: jest.fn(),
      },
    };

    const service = new SystemSettingsService(prismaMock as any);

    await expect(
      service.updateCalendarWindow({
        slotMinTime: '23:00:00',
        slotMaxTime: '10:00:00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
