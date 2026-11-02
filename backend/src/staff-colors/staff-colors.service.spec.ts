import { ServiceUnavailableException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { StaffColorsService } from './staff-colors.service';
import { DEFAULT_PENDING_EMPLOYEE_COLOR } from '../common/pending-assignment';
import { chooseColor, colorFamily } from './color-palette';

describe('persisted identity color source', () => {
  const employee = { id: 'id-1', username: 'login', role: UserRole.EMPLOYEE };
  const manager = { ...employee, role: UserRole.MANAGER };
  const tx = {
    staffColorMap: { findUnique: jest.fn(), create: jest.fn() },
    managerColorMap: { findUnique: jest.fn(), create: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const service = new StaffColorsService(tx as never);
  beforeEach(() => jest.resetAllMocks());

  it('uses userID+shopID, never a name; manager uses only userID', async () => {
    tx.staffColorMap.findUnique.mockResolvedValue({ color: '#60a5fa' });
    expect(await service.get(employee, 'shop-a')).toBe('#60a5fa');
    expect(tx.staffColorMap.findUnique).toHaveBeenCalledWith({
      where: { shopId_userId: { shopId: 'shop-a', userId: employee.id } },
      select: { color: true },
    });
    tx.managerColorMap.findUnique.mockResolvedValue({ color: '#4ade80' });
    expect(await service.get(manager, 'shop-a')).toBe(
      await service.get(manager, 'shop-b'),
    );
    expect(tx.managerColorMap.findUnique).toHaveBeenCalledWith({
      where: { userId: manager.id },
      select: { color: true },
    });
  });
  it('fails explicitly when missing; excludes nonservice roles and pending from maps', async () => {
    await expect(service.get(employee, 'shop-a')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    for (const role of [UserRole.ADMIN, UserRole.SHOP_ACCOUNT]) {
      expect(
        await service.get({ ...employee, role }, 'shop-a'),
      ).toBeUndefined();
    }
    expect(
      await service.get(
        { ...employee, username: 'pending_assignment__shop-a' },
        'shop-a',
      ),
    ).toBe(DEFAULT_PENDING_EMPLOYEE_COLOR);
    expect(tx.staffColorMap.findUnique).toHaveBeenCalledTimes(1);
  });
  it('takes global lock before shop lock', async () => {
    await service.lock(tx as never, 'shop-a');
    const calls = tx.$queryRaw.mock.calls as unknown[][];
    expect((calls[0][0] as string[]).join('')).toContain('714021');
    expect((calls[1][0] as string[]).join('')).toContain('714022');
  });

  it('reserves global manager and local employee families without recoloring old IDs', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([{ color: '#facc15' }])
      .mockResolvedValueOnce([{ color: '#4ade80' }]);
    const color = await service.allocate(tx as never, employee, 'shop-a');
    expect(color).toBe(
      chooseColor(['#facc15', '#4ade80'], DEFAULT_PENDING_EMPLOYEE_COLOR),
    );
    expect([colorFamily('#facc15'), colorFamily('#4ade80')]).not.toContain(
      colorFamily(color!),
    );
    expect(tx.staffColorMap.create).toHaveBeenCalledWith({
      data: { shopId: 'shop-a', userId: employee.id, color },
    });
    tx.staffColorMap.findUnique.mockResolvedValue({ color });
    expect(
      await service.allocate(
        tx as never,
        { ...employee, username: 'renamed' },
        'shop-a',
      ),
    ).toBe(color);
    expect(tx.staffColorMap.create).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('new manager avoids active/inactive employee families globally and invalid reservations fail before insert', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([{ color: '#facc15' }])
      .mockResolvedValueOnce([{ color: '#4ade80' }, { color: '#e879f9' }]);
    const color = await service.allocate(tx as never, manager, 'shop-b');
    expect([1, 2, 5]).not.toContain(colorFamily(color!));
    const calls = tx.$queryRaw.mock.calls as unknown[][];
    const sql = (calls[1][0] as string[]).join('');
    expect(sql).toContain("u.status::text IN ('active', 'inactive')");
    expect(sql).toContain('u.deleted_at IS NULL');
    expect(sql).toContain("u.role::text = 'employee'");
    expect(sql).toContain('NOT starts_with(u.username,');
    expect(sql).not.toContain('shop_id =');
    expect(tx.managerColorMap.create).toHaveBeenCalledWith({
      data: { userId: manager.id, color },
    });
    tx.$queryRaw
      .mockResolvedValueOnce([{ color: 'invalid' }])
      .mockResolvedValueOnce([]);
    await expect(
      service.allocate(tx as never, employee, 'shop-a'),
    ).rejects.toThrow('Invalid staff color');
    expect(tx.staffColorMap.create).not.toHaveBeenCalled();
  });
  it('employee -> inactive -> new manager -> reactivate keeps original mappings', async () => {
    const newManager = {
      ...manager,
      id: 'new-manager',
      username: 'new-manager',
    };
    const savedEmployees = new Map<string, string>();
    const statuses = new Map<string, UserStatus>();
    let managerColor: string | undefined;
    tx.staffColorMap.findUnique.mockImplementation(
      (args: { where: { shopId_userId: { userId: string } } }) => {
        const color = savedEmployees.get(args.where.shopId_userId.userId);
        return color ? { color } : null;
      },
    );
    tx.staffColorMap.create.mockImplementation(
      (args: { data: { userId: string; color: string } }) => {
        statuses.set(args.data.userId, UserStatus.ACTIVE);
        savedEmployees.set(args.data.userId, args.data.color);
      },
    );
    tx.managerColorMap.findUnique.mockImplementation(() =>
      managerColor ? { color: managerColor } : null,
    );
    tx.managerColorMap.create.mockImplementation(
      (args: { data: { color: string } }) => {
        managerColor = args.data.color;
      },
    );
    tx.$queryRaw.mockResolvedValue([]);
    const original = await service.allocate(tx as never, employee, 'shop-a');
    const otherEmployee = { ...employee, id: 'other-store-employee' };
    const otherOriginal = await service.allocate(
      tx as never,
      otherEmployee,
      'shop-c',
    );
    statuses.set(employee.id, UserStatus.INACTIVE);
    statuses.set(otherEmployee.id, UserStatus.INACTIVE);
    tx.$queryRaw.mockImplementation((parts: TemplateStringsArray) => {
      const sql = parts.join('');
      if (!sql.includes('JOIN users')) return [];
      expect(sql).toContain("u.status::text IN ('active', 'inactive')");
      expect(sql).not.toContain('shop_id =');
      return [...savedEmployees.entries()]
        .filter(([id]) => statuses.get(id) === UserStatus.INACTIVE)
        .map(([, color]) => ({ color }));
    });
    const allocated = await service.allocate(tx as never, newManager, 'shop-b');
    expect(allocated).not.toBe(original);
    expect(allocated).not.toBe(otherOriginal);
    statuses.set(employee.id, UserStatus.ACTIVE);
    statuses.set(otherEmployee.id, UserStatus.ACTIVE);
    expect(await service.allocate(tx as never, employee, 'shop-a')).toBe(
      original,
    );
    expect(await service.get(otherEmployee, 'shop-c')).toBe(otherOriginal);
    expect(await service.get(newManager, 'shop-c')).toBe(allocated);
    expect(tx.staffColorMap.create).toHaveBeenCalledTimes(2);
  });
});
