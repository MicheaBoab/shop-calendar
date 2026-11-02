import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  Prisma,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { SHOP_SCOPED_PRISMA } from '../common/prisma/prisma.module';
import type { ShopScopedPrismaClient } from '../common/prisma/prisma.module';
import { requireCurrentShopId } from '../common/shop-context/shop-context';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserPasswordDto } from './dto/update-user-password.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { getPendingAssignmentEmployeeUsernameForShop } from '../common/pending-assignment';
import { isPendingAssignmentEmployeeUsername } from '../common/pending-assignment';
import { canCreateManagedUserRole } from '../auth/role-capabilities';
import { PrismaService } from '../common/prisma/prisma.service';
import { StaffColorsService } from '../staff-colors/staff-colors.service';

@Injectable()
export class UsersService {
  constructor(
    @Inject(SHOP_SCOPED_PRISMA)
    private readonly prismaService: ShopScopedPrismaClient,
    private readonly auditService: AuditService,
    private readonly basePrismaService: PrismaService,
    private readonly staffColors: StaffColorsService,
  ) {}

  async listUsers() {
    const users = await this.prismaService.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return this.withStaffColors(users);
  }

  async listServiceStaff() {
    const shopId = requireCurrentShopId();
    // This deliberately uses the base client: adding the extension's shopId
    // predicate to this OR would hide managers whose home shop differs.
    const users = await this.basePrismaService.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        deletedAt: null,
        OR: [{ shopId, role: UserRole.EMPLOYEE }, { role: UserRole.MANAGER }],
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        status: true,
      },
      orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
    });

    const serviceStaff = await this.withStaffColors(users);
    return serviceStaff.sort((left, right) => {
      const leftManager = left.role === UserRole.MANAGER;
      const rightManager = right.role === UserRole.MANAGER;
      return (
        Number(leftManager) - Number(rightManager) ||
        left.displayName.localeCompare(right.displayName)
      );
    });
  }

  async createUser(dto: CreateUserDto, actorUserId: string) {
    if (!canCreateManagedUserRole(dto.role)) {
      throw new BadRequestException(
        'Only employee accounts can be created from this endpoint.',
      );
    }

    const shopId = requireCurrentShopId();
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const displayName = dto.displayName ?? dto.username;
    const auditContext =
      await this.auditService.createAuditContext(actorUserId);

    const created = await this.prismaService.$transaction(async (tx) => {
      await this.staffColors.lock(
        tx as unknown as Prisma.TransactionClient,
        shopId,
      );
      const createdUser = await tx.user.create({
        data: {
          shopId,
          username: dto.username,
          passwordHash,
          displayName,
          role: dto.role,
        },
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const resolvedColor = await this.staffColors.allocate(
        tx as unknown as Prisma.TransactionClient,
        createdUser,
        shopId,
      );

      const withColor = resolvedColor
        ? { ...createdUser, color: resolvedColor }
        : createdUser;
      await this.auditService.recordUserManagementChange(
        {
          actorUserId,
          action: 'user.create',
          entityId: createdUser.id,
          beforePayload: null,
          afterPayload: this.toAuditPayload(withColor),
        },
        auditContext,
        tx as unknown as Prisma.TransactionClient,
      );
      return withColor;
    });

    return created;
  }

  async updateUserStatus(
    id: string,
    dto: UpdateUserStatusDto,
    actorUserId: string,
  ) {
    const auditContext =
      await this.auditService.createAuditContext(actorUserId);
    const { existing, updated } = await this.prismaService.$transaction(
      async (tx) => {
        const before = await this.ensureUserExists(
          id,
          tx as unknown as Prisma.TransactionClient,
        );
        const after = await tx.user.update({
          where: { id },
          data: { status: dto.status },
          select: {
            id: true,
            username: true,
            displayName: true,
            role: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
          },
        });
        await this.auditService.recordUserManagementChange(
          {
            actorUserId,
            action: 'user.status.update',
            entityId: after.id,
            beforePayload: this.toAuditPayload(before),
            afterPayload: this.toAuditPayload(after),
          },
          auditContext,
          tx as unknown as Prisma.TransactionClient,
        );
        return { existing: before, updated: after };
      },
    );
    const resolvedColor = await this.staffColors.get(
      existing,
      requireCurrentShopId(),
    );

    return { ...updated, color: resolvedColor };
  }

  async updateUserPassword(
    id: string,
    dto: UpdateUserPasswordDto,
    actorUserId: string,
  ) {
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    const auditContext =
      await this.auditService.createAuditContext(actorUserId);
    const { existing, updated } = await this.prismaService.$transaction(
      async (tx) => {
        const before = await this.ensureUserExists(
          id,
          tx as unknown as Prisma.TransactionClient,
        );
        const after = await tx.user.update({
          where: { id },
          data: { passwordHash },
          select: {
            id: true,
            username: true,
            displayName: true,
            role: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
          },
        });
        await this.auditService.recordUserManagementChange(
          {
            actorUserId,
            action: 'user.password.update',
            entityId: after.id,
            beforePayload: this.toAuditPayload(before),
            afterPayload: this.toAuditPayload(after),
          },
          auditContext,
          tx as unknown as Prisma.TransactionClient,
        );
        return { existing: before, updated: after };
      },
    );
    const resolvedColor = await this.staffColors.get(
      existing,
      requireCurrentShopId(),
    );

    return { ...updated, color: resolvedColor };
  }

  async removeUser(id: string, actorUserId: string) {
    if (id === actorUserId) {
      throw new BadRequestException('User cannot remove their own account.');
    }

    const shopId = requireCurrentShopId();
    const auditContext =
      await this.auditService.createAuditContext(actorUserId);
    // Deliberately non-scoped: managers can serve appointments in other shops.
    // The account lookup itself remains restricted to the administrator's shop.
    const { removed, resolvedColor } =
      await this.basePrismaService.$transaction(
        async (tx) => {
          const before = await tx.user.findFirst({
            where: { id, shopId, deletedAt: null },
          });
          if (!before) throw new NotFoundException('User not found');
          if (isPendingAssignmentEmployeeUsername(before.username)) {
            throw new BadRequestException(
              'Pending assignment account cannot be removed.',
            );
          }
          const resolvedColor = await this.staffColors.get(before, shopId, tx);
          const now = new Date();
          const futureWhere = {
            employeeId: id,
            status: AppointmentStatus.SCHEDULED,
            deletedAt: null,
            startAt: { gt: now },
          };
          // UPDATE takes a row write lock conflicting with eligibility FOR SHARE.
          // Wait for earlier assignments to commit BEFORE taking the shop snapshot.
          // Later eligibility reads then see the inactive/deleted account.
          const after = await tx.user.update({
            where: { id, shopId },
            data: {
              status: UserStatus.INACTIVE,
              deletedAt: now,
            },
            select: {
              id: true,
              username: true,
              displayName: true,
              role: true,
              status: true,
              createdAt: true,
              updatedAt: true,
              deletedAt: true,
            },
          });
          const affectedShops =
            before.role === UserRole.MANAGER
              ? await tx.appointment.findMany({
                  where: futureWhere,
                  distinct: ['shopId'],
                  select: { shopId: true },
                  orderBy: { shopId: 'asc' },
                })
              : [{ shopId }];
          for (const affected of affectedShops) {
            const targetShopId = affected.shopId;
            const pendingEmployee = await tx.user.findFirst({
              where: {
                shopId: targetShopId,
                username:
                  getPendingAssignmentEmployeeUsernameForShop(targetShopId),
                role: UserRole.EMPLOYEE,
                status: UserStatus.ACTIVE,
                deletedAt: null,
              },
              select: { id: true },
            });
            if (!pendingEmployee) {
              throw new BadRequestException(
                `Pending assignment employee missing for shop ${targetShopId}`,
              );
            }
            const result = await tx.appointment.updateMany({
              where: { ...futureWhere, shopId: targetShopId },
              data: {
                employeeId: pendingEmployee.id,
                // Preserve the removed employee's historical snapshot; the UI
                // resolves pending name/color from the current employeeId first.
                employeeDisplayName: before.displayName ?? before.username,
                employeeColor: resolvedColor,
              },
            });
            if (targetShopId !== shopId) {
              const shop = await tx.shop.findUnique({
                where: { id: targetShopId },
                select: { id: true, name: true },
              });
              if (!shop) throw new NotFoundException('Shop not found');
              await this.auditService.recordUserManagementChange(
                {
                  actorUserId,
                  action: 'user.remove',
                  entityId: id,
                  beforePayload: this.toAuditPayload(before),
                  afterPayload: {
                    ...this.toAuditPayload(after),
                    reassignedAppointments: result.count,
                  },
                },
                { ...auditContext, shopId: targetShopId, shopSnapshot: shop },
                tx,
              );
            }
          }
          await this.auditService.recordUserManagementChange(
            {
              actorUserId,
              action: 'user.remove',
              entityId: after.id,
              beforePayload: this.toAuditPayload(before),
              afterPayload: this.toAuditPayload(after),
            },
            auditContext,
            tx,
          );
          return { removed: after, resolvedColor };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    return { ...removed, color: resolvedColor };
  }

  private async ensureUserExists(
    id: string,
    client: Pick<Prisma.TransactionClient, 'user'> = this
      .prismaService as unknown as Prisma.TransactionClient,
  ) {
    const user = await client.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private async withStaffColors<
    T extends { id: string; username: string; role: UserRole },
  >(users: T[]) {
    return Promise.all(
      users.map(async (user) => {
        const color = await this.staffColors.get(user, requireCurrentShopId());
        return { ...user, color };
      }),
    );
  }

  private toAuditPayload(user: {
    id: string;
    username: string;
    displayName: string;
    role: UserRole;
    status: UserStatus;
    createdAt?: Date;
    updatedAt?: Date;
    deletedAt?: Date | null;
    color?: string;
  }) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt,
      color: user.color,
    };
  }
}
