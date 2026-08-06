import { UserRole, UserStatus } from '@prisma/client';
import { UsersService } from './users.service';

describe('UsersService staff color mapping', () => {
  let service: UsersService;
  let prismaService: any;
  let auditService: any;

  beforeEach(() => {
    prismaService = {
      $transaction: jest.fn(async (callback: any) => callback(prismaService)),
      user: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      staffColorMap: {
        findUnique: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
      },
    };

    auditService = {
      recordUserManagementChange: jest.fn().mockResolvedValue(undefined),
    };

    service = new UsersService(prismaService, auditService);
  });

  it('reuses a persisted color for the same employee name', async () => {
    prismaService.staffColorMap.findUnique.mockResolvedValue({ color: '#123456' });
    prismaService.user.create.mockResolvedValue({
      id: 'user-1',
      username: 'alice',
      displayName: 'Alice',
      role: UserRole.EMPLOYEE,
      status: UserStatus.ACTIVE,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    });

    const created = await service.createUser({
      username: 'alice',
      password: 'password123',
      displayName: 'Alice',
      role: UserRole.EMPLOYEE,
    }, 'admin-1');

    expect(created.color).toBe('#123456');
    expect(prismaService.staffColorMap.upsert).not.toHaveBeenCalled();
  });

  it('persists the default color when no persisted mapping exists', async () => {
    prismaService.staffColorMap.findUnique.mockResolvedValue(null);
    prismaService.user.create.mockResolvedValue({
      id: 'user-2',
      username: 'alice',
      displayName: 'Alice',
      role: UserRole.EMPLOYEE,
      status: UserStatus.ACTIVE,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    });

    const created = await service.createUser({
      username: 'alice',
      password: 'password123',
      displayName: 'Alice',
      role: UserRole.EMPLOYEE,
    }, 'admin-1');

    expect(created.color).toBe('hsl(17 70% 56%)');
    expect(prismaService.staffColorMap.create).toHaveBeenCalledWith({
      data: { staffName: 'alice', color: 'hsl(17 70% 56%)' },
    });
  });
});
