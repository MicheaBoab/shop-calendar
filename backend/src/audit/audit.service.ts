import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

type AppointmentAuditChange = {
	actorUserId: string;
	action:
		| 'appointment.create'
		| 'appointment.update'
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
		| 'user.password.update'
		| 'user.remove';
	entityId: string;
	beforePayload: Prisma.InputJsonValue | null;
	afterPayload: Prisma.InputJsonValue | null;
};

type ListAuditLogsQuery = {
	page: number;
	limit: number;
	entityType?: 'appointment' | 'user';
};

@Injectable()
export class AuditService {
	constructor(private readonly prismaService: PrismaService) {}

	async recordAppointmentChange(change: AppointmentAuditChange) {
		await this.createAuditLog({
			actorUserId: change.actorUserId,
			action: change.action,
			entityType: 'appointment',
			entityId: change.entityId,
			beforePayload: change.beforePayload,
			afterPayload: change.afterPayload,
		});
	}

	async recordUserManagementChange(change: UserManagementAuditChange) {
		await this.createAuditLog({
			actorUserId: change.actorUserId,
			action: change.action,
			entityType: 'user',
			entityId: change.entityId,
			beforePayload: change.beforePayload,
			afterPayload: change.afterPayload,
		});
	}

	async listAuditLogs(query: ListAuditLogsQuery) {
		const skip = (query.page - 1) * query.limit;
		const where = query.entityType ? { entityType: query.entityType } : undefined;

		const [total, items] = await this.prismaService.$transaction([
			this.prismaService.auditLog.count({ where }),
			this.prismaService.auditLog.findMany({
				where,
				skip,
				take: query.limit,
				orderBy: { createdAt: 'desc' },
				include: {
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
				actor: item.actor,
			})),
		};
	}

	private async createAuditLog(change: {
		actorUserId: string;
		action: string;
		entityType: 'appointment' | 'user';
		entityId: string;
		beforePayload: Prisma.InputJsonValue | null;
		afterPayload: Prisma.InputJsonValue | null;
	}) {
		await this.prismaService.auditLog.create({
			data: {
				actorUserId: change.actorUserId,
				action: change.action,
				entityType: change.entityType,
				entityId: change.entityId,
				beforePayload: change.beforePayload ?? Prisma.JsonNull,
				afterPayload: change.afterPayload ?? Prisma.JsonNull,
			},
		});
	}
}
