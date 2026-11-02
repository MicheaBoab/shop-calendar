import { BadRequestException } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';
import type { ShopScopedPrismaClient } from '../common/prisma/prisma.module';
import type { AuditService } from '../audit/audit.service';

jest.mock('../common/shop-context/shop-context', () => ({
  requireCurrentShopId: jest.fn(() => 'prosper'),
}));

describe('SystemSettingsService', () => {
  it.each([
    [null, { slotMinTime: '10:00:00', slotMaxTime: '20:00:00' }],
    [
      { calendarWindowStart: null, calendarWindowEnd: null },
      { slotMinTime: '10:00:00', slotMaxTime: '20:00:00' },
    ],
    [
      { calendarWindowStart: '09:00:00', calendarWindowEnd: null },
      { slotMinTime: '09:00:00', slotMaxTime: '20:00:00' },
    ],
    [
      { calendarWindowStart: null, calendarWindowEnd: '23:00:00' },
      { slotMinTime: '10:00:00', slotMaxTime: '23:00:00' },
    ],
    [
      { calendarWindowStart: '10:00:00', calendarWindowEnd: '23:00:00' },
      { slotMinTime: '10:00:00', slotMaxTime: '23:00:00' },
    ],
  ])(
    'reads %j with saved fields taking priority and no writes',
    async (saved, expected) => {
      const prismaMock = {
        systemSetting: {
          findUnique: jest.fn().mockResolvedValue(saved),
          create: jest.fn(),
          update: jest.fn(),
          upsert: jest.fn(),
        },
        $transaction: jest.fn(),
      };

      const auditService = { createAuditContext: jest.fn() };
      const service = new SystemSettingsService(
        prismaMock as unknown as ShopScopedPrismaClient,
        auditService as unknown as AuditService,
      );

      await expect(service.getCalendarWindow()).resolves.toEqual(expected);
      expect(prismaMock.systemSetting.findUnique).toHaveBeenCalledWith({
        where: { shopId: 'prosper' },
        select: { calendarWindowStart: true, calendarWindowEnd: true },
      });
      expect(prismaMock.systemSetting.create).not.toHaveBeenCalled();
      expect(prismaMock.systemSetting.update).not.toHaveBeenCalled();
      expect(prismaMock.systemSetting.upsert).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(auditService.createAuditContext).not.toHaveBeenCalled();
    },
  );

  it('rejects ranges where start is not earlier than end', async () => {
    const prismaMock = {
      systemSetting: {
        upsert: jest.fn(),
      },
    };

    const service = new SystemSettingsService(prismaMock as any, {} as any);

    await expect(
      service.updateCalendarWindow(
        {
          slotMinTime: '23:00:00',
          slotMaxTime: '10:00:00',
        },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writes settings audit within the same transaction', async () => {
    let transactionOpen = false;
    const tx = {
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue({
          calendarWindowStart: '10:00:00',
          calendarWindowEnd: '23:00:00',
        }),
        upsert: jest.fn().mockResolvedValue({
          calendarWindowStart: '09:00:00',
          calendarWindowEnd: '22:00:00',
        }),
      },
    };
    const prismaMock = {
      $transaction: jest.fn(async (callback: (client: unknown) => unknown) => {
        transactionOpen = true;
        try {
          return await callback(tx);
        } finally {
          transactionOpen = false;
        }
      }),
    };
    const auditService = {
      createAuditContext: jest.fn().mockResolvedValue({
        actorUserId: 'admin-1',
        shopId: 'prosper',
        actorSnapshot: { id: 'admin-1', role: 'ADMIN' },
        shopSnapshot: { id: 'prosper', name: 'Prosper' },
      }),
      recordSettingsChange: jest.fn(
        async (_change: unknown, _context: unknown, writer: unknown) => {
          expect(transactionOpen).toBe(true);
          expect(writer).toBe(tx);
        },
      ),
    };
    const service = new SystemSettingsService(
      prismaMock as any,
      auditService as any,
    );

    await expect(
      service.updateCalendarWindow(
        {
          slotMinTime: '09:00:00',
          slotMaxTime: '22:00:00',
        },
        'admin-1',
      ),
    ).resolves.toEqual({
      slotMinTime: '09:00:00',
      slotMaxTime: '22:00:00',
    });
    expect(auditService.recordSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        beforePayload: { slotMinTime: '10:00:00', slotMaxTime: '23:00:00' },
        afterPayload: { slotMinTime: '09:00:00', slotMaxTime: '22:00:00' },
      }),
      expect.objectContaining({ actorUserId: 'admin-1' }),
      tx,
    );
    expect(transactionOpen).toBe(false);
  });
});
