import { AuditService } from './audit.service';
import { requireCurrentShopId } from '../common/shop-context/shop-context';
import { Prisma } from '@prisma/client';
import type { ShopScopedPrismaClient } from '../common/prisma/prisma.module';
import type { PrismaService } from '../common/prisma/prisma.service';

jest.mock('../common/shop-context/shop-context', () => ({
  requireCurrentShopId: jest.fn(() => 'shop-current'),
}));

describe('AuditService snapshots', () => {
  it('stores immutable actor/shop snapshots without selecting credentials', async () => {
    const auditLog = {
      create: jest
        .fn<Promise<{ id: string }>, [Prisma.AuditLogCreateArgs]>()
        .mockResolvedValue({ id: 'log-1' }),
    };
    const basePrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'actor-1',
          username: 'admin',
          displayName: 'Shop Admin',
          role: 'ADMIN',
          passwordHash: 'must-not-be-snapshotted',
          token: 'must-not-be-snapshotted',
        }),
      },
      shop: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'shop-current',
          name: 'Current Shop',
        }),
      },
    };
    const service = new AuditService(
      { auditLog } as unknown as ShopScopedPrismaClient,
      basePrisma as unknown as PrismaService,
    );
    const context = await service.createAuditContext('actor-1');
    const transactionWriter = { auditLog };

    await service.recordAppointmentChange(
      {
        actorUserId: 'actor-1',
        action: 'appointment.create',
        entityId: 'appointment-group-1',
        beforePayload: null,
        afterPayload: {
          groupId: 'appointment-group-1',
          appointments: [
            { employeeDisplayName: 'Alex', employeeColor: '#123456' },
          ],
        },
      },
      context,
      transactionWriter as unknown as Pick<
        Prisma.TransactionClient,
        'auditLog'
      >,
    );

    expect(requireCurrentShopId).toHaveBeenCalled();
    expect(basePrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'actor-1' },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
      },
    });
    expect(auditLog.create.mock.calls[0][0].data).toMatchObject({
      shopId: 'shop-current',
      actorUserId: 'actor-1',
      actorSnapshot: {
        id: 'actor-1',
        username: 'admin',
        displayName: 'Shop Admin',
        role: 'ADMIN',
      },
      shopSnapshot: { id: 'shop-current', name: 'Current Shop' },
    });
    expect(JSON.stringify(auditLog.create.mock.calls[0][0])).not.toContain(
      'must-not-be-snapshotted',
    );
  });

  it('propagates audit writer errors so the enclosing business transaction can roll back', async () => {
    const service = new AuditService(
      {} as ShopScopedPrismaClient,
      {} as PrismaService,
    );
    const context = {
      actorUserId: 'actor-1',
      shopId: 'shop-current',
      actorSnapshot: { id: 'actor-1', role: 'ADMIN' },
      shopSnapshot: { id: 'shop-current', name: 'Current Shop' },
    };
    const writer = {
      auditLog: {
        create: jest.fn().mockRejectedValue(new Error('audit write failed')),
      },
    };

    await expect(
      service.recordSettingsChange(
        {
          actorUserId: 'actor-1',
          entityId: 'shop-current',
          beforePayload: { slotMinTime: '10:00:00' },
          afterPayload: { slotMinTime: '09:00:00' },
        },
        context,
        writer as unknown as Pick<Prisma.TransactionClient, 'auditLog'>,
      ),
    ).rejects.toThrow('audit write failed');
  });
});
