import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SHOP_SCOPED_PRISMA } from '../common/prisma/prisma.module';
import type { ShopScopedPrismaClient } from '../common/prisma/prisma.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { requireCurrentShopId } from '../common/shop-context/shop-context';

type AuditLogWriter = Pick<Prisma.TransactionClient, 'auditLog'>;

export type AuditContext = {
  actorUserId: string;
  shopId: string;
  actorSnapshot: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  shopSnapshot: Prisma.InputJsonValue | typeof Prisma.JsonNull;
};

type AppointmentAuditChange = {
  actorUserId: string;
  action:
    | 'appointment.create'
    | 'appointment.update'
    | 'appointment.move'
    | 'appointment.cancel'
    | 'appointment.delete';
  entityId: string;
  beforePayload: Prisma.InputJsonValue | null;
  afterPayload: Prisma.InputJsonValue | null;
};

type UserManagementAuditChange = {
  actorUserId: string;
  action:
    | 'user.create'
    | 'user.status.update'
    | 'user.color.update'
    | 'user.password.update'
    | 'user.remove';
  entityId: string;
  beforePayload: Prisma.InputJsonValue | null;
  afterPayload: Prisma.InputJsonValue | null;
};

type SettingsAuditChange = {
  actorUserId: string;
  entityId: string;
  beforePayload: Prisma.InputJsonValue | null;
  afterPayload: Prisma.InputJsonValue | null;
};

type ListAuditLogsQuery = {
  page: number;
  limit: number;
  entityType?: 'appointment' | 'user' | 'settings';
};

@Injectable()
export class AuditService {
  constructor(
    @Inject(SHOP_SCOPED_PRISMA)
    private readonly prismaService: ShopScopedPrismaClient,
    private readonly basePrismaService: PrismaService,
  ) {}

  async createAuditContext(actorUserId: string): Promise<AuditContext> {
    const shopId = requireCurrentShopId();
    const [actor, shop] = await Promise.all([
      this.basePrismaService.user.findUnique({
        where: { id: actorUserId },
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
        },
      }),
      this.basePrismaService.shop.findUnique({
        where: { id: shopId },
        select: { id: true, name: true },
      }),
    ]);

    return {
      actorUserId,
      shopId,
      actorSnapshot: actor
        ? {
            id: actor.id,
            username: actor.username,
            displayName: actor.displayName,
            role: actor.role,
          }
        : Prisma.JsonNull,
      shopSnapshot: shop ? { id: shop.id, name: shop.name } : Prisma.JsonNull,
    };
  }

  async recordAppointmentChange(
    change: AppointmentAuditChange,
    context: AuditContext,
    writer?: AuditLogWriter,
  ) {
    await this.createAuditLog(
      {
        actorUserId: change.actorUserId,
        action: change.action,
        entityType: 'appointment',
        entityId: change.entityId,
        beforePayload: change.beforePayload,
        afterPayload: change.afterPayload,
      },
      context,
      writer,
    );
  }

  async recordUserManagementChange(
    change: UserManagementAuditChange,
    context: AuditContext,
    writer?: AuditLogWriter,
  ) {
    await this.createAuditLog(
      {
        actorUserId: change.actorUserId,
        action: change.action,
        entityType: 'user',
        entityId: change.entityId,
        beforePayload: change.beforePayload,
        afterPayload: change.afterPayload,
      },
      context,
      writer,
    );
  }

  async recordSettingsChange(
    change: SettingsAuditChange,
    context: AuditContext,
    writer?: AuditLogWriter,
  ) {
    await this.createAuditLog(
      {
        actorUserId: change.actorUserId,
        action: 'settings.calendar-window.update',
        entityType: 'settings',
        entityId: change.entityId,
        beforePayload: change.beforePayload,
        afterPayload: change.afterPayload,
      },
      context,
      writer,
    );
  }

  async listAuditLogs(query: ListAuditLogsQuery) {
    const skip = (query.page - 1) * query.limit;
    const where = {
      shopId: requireCurrentShopId(),
      ...(query.entityType ? { entityType: query.entityType } : {}),
    };

    const [total, items] = await this.prismaService.$transaction([
      this.prismaService.auditLog.count({ where }),
      this.prismaService.auditLog.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          shop: {
            select: { id: true, name: true },
          },
          actor: {
            select: {
              id: true,
              username: true,
              displayName: true,
              role: true,
            },
          },
        },
      }),
    ]);

    return {
      page: query.page,
      limit: query.limit,
      total,
      items: items.map((item) => ({
        id: item.id,
        action: item.action,
        entityType: item.entityType,
        entityId: item.entityId,
        createdAt: item.createdAt,
        beforePayload: item.beforePayload,
        afterPayload: item.afterPayload,
        actorSnapshot: item.actorSnapshot,
        shopSnapshot: item.shopSnapshot,
        shop: item.shop,
        actor: item.actor,
      })),
    };
  }

  private async createAuditLog(
    change: {
      actorUserId: string;
      action: string;
      entityType: 'appointment' | 'user' | 'settings';
      entityId: string;
      beforePayload: Prisma.InputJsonValue | null;
      afterPayload: Prisma.InputJsonValue | null;
    },
    context: AuditContext,
    writer?: AuditLogWriter,
  ) {
    const auditWriter =
      writer ?? (this.prismaService as unknown as AuditLogWriter);
    await auditWriter.auditLog.create({
      data: {
        shopId: context.shopId,
        actorUserId: context.actorUserId,
        action: change.action,
        entityType: change.entityType,
        entityId: change.entityId,
        beforePayload: change.beforePayload ?? Prisma.JsonNull,
        afterPayload: change.afterPayload ?? Prisma.JsonNull,
        actorSnapshot: context.actorSnapshot,
        shopSnapshot: context.shopSnapshot,
      },
    });
  }
}
