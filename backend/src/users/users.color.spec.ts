import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import { UsersService } from './users.service';
import { StaffColorsService } from '../staff-colors/staff-colors.service';
import { shopContextStorage } from '../common/shop-context/shop-context';
import { chooseColor } from '../staff-colors/color-palette';
import { DEFAULT_PENDING_EMPLOYEE_COLOR } from '../common/pending-assignment';

describe('local employee color reassignment transaction', () => {
  const employee = {
    id: 'employee-a', shopId: 'shop-a', username: 'anna', displayName: 'Anna',
    role: UserRole.EMPLOYEE, status: UserStatus.ACTIVE, deletedAt: null,
  };
  let current: string;
  let reservations: Array<{ color: string }>;
  const tx = {
    user: { findFirst: jest.fn() },
    staffColorMap: { findUnique: jest.fn(), update: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const audit = { createAuditContext: jest.fn(), recordUserManagementChange: jest.fn() };
  const staff = new StaffColorsService(tx as never);
  const service = new UsersService({} as never, audit as never, tx as never, staff);
  const inShop = <T>(callback: () => T) => shopContextStorage.run({
    shopId: 'shop-a', userId: 'admin-a', role: UserRole.ADMIN,
  }, callback);
  beforeEach(() => {
    jest.resetAllMocks();
    current = '#60a5fa';
    reservations = [{ color: '#4ade80' }];
    tx.$transaction.mockImplementation((callback: (value: unknown) => Promise<unknown>) => callback(tx));
    tx.user.findFirst.mockResolvedValue(employee);
    tx.staffColorMap.findUnique.mockImplementation(() => ({ color: current }));
    tx.staffColorMap.update.mockImplementation((args: { data: { color: string } }) => { current = args.data.color; });
    tx.$queryRaw.mockImplementation((sql: TemplateStringsArray) => {
      const text = sql.join('');
      if (text.includes('pg_advisory')) return [];
      if (text.includes('manager_color_map')) return [{ color: '#facc15' }];
      return [{ color: current }, ...reservations];
    });
    audit.createAuditContext.mockResolvedValue({ shopId: 'shop-a' });
    audit.recordUserManagementChange.mockResolvedValue(undefined);
  });
  it('preview is read-only; confirmation persists the candidate and changes only appointment color snapshots', async () => {
    const preview = await inShop(() => service.previewUserColor(employee.id));
    expect(preview).toEqual({
      currentColor: '#60a5fa',
      candidateColor: chooseColor(['#facc15', '#60a5fa', '#4ade80'], DEFAULT_PENDING_EMPLOYEE_COLOR),
    });
    expect(tx.staffColorMap.update).not.toHaveBeenCalled();
    expect(audit.recordUserManagementChange).not.toHaveBeenCalled();
    expect(tx.user.findFirst).toHaveBeenCalledWith({
      where: { id: employee.id, shopId: 'shop-a', role: UserRole.EMPLOYEE, deletedAt: null },
    });
    const result = await inShop(() => service.reassignUserColor(employee.id, preview as never, 'admin-a'));
    expect(result.color).toBe(preview.candidateColor);
    expect(result.color).not.toBe(preview.currentColor);
    expect(tx.staffColorMap.update).toHaveBeenCalledWith({
      where: { shopId_userId: { shopId: 'shop-a', userId: employee.id } },
      data: { color: preview.candidateColor },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [sql, ...values] = tx.$executeRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const normalizedSql = sql.join('').replace(/\s+/g, ' ').trim();
    expect(normalizedSql).toBe(
      'UPDATE appointments SET employee_color = WHERE shop_id = AND employee_id =',
    );
    expect(values).toEqual([preview.candidateColor, 'shop-a', employee.id]);
    expect(tx.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(audit.recordUserManagementChange).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.color.update',
        beforePayload: expect.objectContaining({ color: preview.currentColor }),
        afterPayload: expect.objectContaining({ color: preview.candidateColor }),
      }), { shopId: 'shop-a' }, tx,
    );
    const first = (tx.$queryRaw.mock.calls[0][0] as string[]).join('');
    expect(first).toContain('714021');
    expect((tx.$queryRaw.mock.calls[1][0] as string[]).join('')).toContain('714022');
  });
  it('rejects stale previews and arbitrary manually chosen colors without writes', async () => {
    const preview = await inShop(() => service.previewUserColor(employee.id));
    reservations.push({ color: preview.candidateColor });
    await expect(inShop(() => service.reassignUserColor(employee.id, preview as never, 'admin-a'))).rejects.toBeInstanceOf(ConflictException);
    reservations = [{ color: '#4ade80' }];
    await expect(inShop(() => service.reassignUserColor(employee.id, { currentColor: current, candidateColor: '#000000' }, 'admin-a'))).rejects.toBeInstanceOf(ConflictException);
    current = '#22d3ee';
    await expect(inShop(() => service.reassignUserColor(employee.id, preview as never, 'admin-a'))).rejects.toBeInstanceOf(ConflictException);
    expect(tx.staffColorMap.update).not.toHaveBeenCalled();
    expect(audit.recordUserManagementChange).not.toHaveBeenCalled();
  });
  it('returns a retryable conflict when the serializable color transaction conflicts', async () => {
    const preview = await inShop(() => service.previewUserColor(employee.id));
    tx.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('serialization failure', {
        code: 'P2034',
        clientVersion: 'test',
      }),
    );
    await expect(
      inShop(() =>
        service.reassignUserColor(employee.id, preview as never, 'admin-a'),
      ),
    ).rejects.toMatchObject({
      status: 409,
      message:
        'A concurrent color or appointment change occurred. Refresh and retry.',
    });
    expect(tx.staffColorMap.update).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(audit.recordUserManagementChange).not.toHaveBeenCalled();
  });
  it('excludes foreign/deleted/nonemployee users through the query and blocks the local pending account', async () => {
    tx.user.findFirst.mockResolvedValue(null);
    await expect(inShop(() => service.previewUserColor('foreign'))).rejects.toBeInstanceOf(NotFoundException);
    tx.user.findFirst.mockResolvedValue({ ...employee, username: 'pending_assignment__shop-a' });
    await expect(inShop(() => service.previewUserColor(employee.id))).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.staffColorMap.update).not.toHaveBeenCalled();
  });
});
