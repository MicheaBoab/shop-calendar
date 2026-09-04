import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { SHOP_SCOPED_PRISMA } from '../common/prisma/prisma.module';
import type { ShopScopedPrismaClient } from '../common/prisma/prisma.module';
import { requireCurrentShopId } from '../common/shop-context/shop-context';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserPasswordDto } from './dto/update-user-password.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { getPendingAssignmentEmployeeUsernameForShop } from '../common/pending-assignment';

@Injectable()
export class UsersService {
	constructor(
		@Inject(SHOP_SCOPED_PRISMA) private readonly prismaService: ShopScopedPrismaClient,
		private readonly auditService: AuditService,
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

	async createUser(dto: CreateUserDto, actorUserId: string) {
		if (dto.role !== UserRole.EMPLOYEE) {
			throw new BadRequestException('Only EMPLOYEE accounts can be created from this endpoint.');
		}

		const shopId = requireCurrentShopId();
		const passwordHash = await bcrypt.hash(dto.password, 10);
		const displayName = dto.displayName ?? dto.username;
		const staffName = this.normalizeStaffName(displayName);

		const created = await this.prismaService.$transaction(async (tx) => {
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

			const resolvedColor = await this.getStaffColor(staffName);
			const existingMapping = await tx.staffColorMap.findUnique({
				where: { shopId_staffName: { shopId, staffName } },
			});
			if (!existingMapping) {
				await tx.staffColorMap.create({
					data: { shopId, staffName, color: resolvedColor },
				});
			}

			return { ...createdUser, color: resolvedColor };
		});

		await this.auditService.recordUserManagementChange({
			actorUserId,
			action: 'user.create',
			entityId: created.id,
			beforePayload: null,
			afterPayload: this.toAuditPayload(created),
		});

		return created;
	}

	async updateUserStatus(id: string, dto: UpdateUserStatusDto, actorUserId: string) {
		const existing = await this.ensureUserExists(id);
		const updated = await this.prismaService.user.update({
			where: { id },
			data: { status: dto.status },
			select: {
				id: true,
				username: true,
				displayName: true,
				role: true,
				status: true,
				updatedAt: true,
			},
		});
		const resolvedColor = await this.getStaffColor(existing.displayName ?? existing.username);

		await this.auditService.recordUserManagementChange({
			actorUserId,
			action: 'user.status.update',
			entityId: updated.id,
			beforePayload: this.toAuditPayload(existing),
			afterPayload: this.toAuditPayload(updated),
		});

		return { ...updated, color: resolvedColor };
	}

	async updateUserPassword(id: string, dto: UpdateUserPasswordDto, actorUserId: string) {
		const existing = await this.ensureUserExists(id);
		const passwordHash = await bcrypt.hash(dto.newPassword, 10);
		const updated = await this.prismaService.user.update({
			where: { id },
			data: { passwordHash },
			select: {
				id: true,
				username: true,
				displayName: true,
				role: true,
				status: true,
				updatedAt: true,
				deletedAt: true,
			},
		});
		const resolvedColor = await this.getStaffColor(existing.displayName ?? existing.username);

		await this.auditService.recordUserManagementChange({
			actorUserId,
			action: 'user.password.update',
			entityId: updated.id,
			beforePayload: this.toAuditPayload(existing),
			afterPayload: this.toAuditPayload(updated),
		});

		return { ...updated, color: resolvedColor };
	}

	async removeUser(id: string, actorUserId: string) {
		if (id === actorUserId) {
			throw new BadRequestException('User cannot remove their own account.');
		}

		const existing = await this.ensureUserExists(id);
		const removed = await this.prismaService.user.update({
			where: { id },
			data: {
				status: UserStatus.INACTIVE,
				deletedAt: new Date(),
			},
			select: {
				id: true,
				username: true,
				displayName: true,
				role: true,
				status: true,
				updatedAt: true,
				deletedAt: true,
			},
		});
		const resolvedColor = await this.getStaffColor(existing.displayName ?? existing.username);
		const pendingEmployee = await this.prismaService.user.findFirst({
			where: { username: getPendingAssignmentEmployeeUsernameForShop(requireCurrentShopId()), deletedAt: null },
			select: { id: true },
		});
		const now = new Date();

		if (pendingEmployee) {
			await this.prismaService.appointment.updateMany({
				where: {
					employeeId: id,
					status: AppointmentStatus.SCHEDULED,
					deletedAt: null,
					startAt: { gt: now },
				},
				data: {
					employeeId: pendingEmployee.id,
					employeeDisplayName: existing.displayName ?? existing.username,
					employeeColor: resolvedColor,
				},
			});
		}

		await this.auditService.recordUserManagementChange({
			actorUserId,
			action: 'user.remove',
			entityId: removed.id,
			beforePayload: this.toAuditPayload(existing),
			afterPayload: this.toAuditPayload(removed),
		});

		return { ...removed, color: resolvedColor };
	}

	private async ensureUserExists(id: string) {
		const user = await this.prismaService.user.findFirst({
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

	private async withStaffColors<T extends { username: string; displayName: string }>(users: T[]) {
		return Promise.all(users.map(async (user) => {
			const color = await this.getStaffColor(user.displayName ?? user.username);
			return { ...user, color };
		}));
	}

	private async getStaffColor(staffName: string) {
		const normalizedStaffName = this.normalizeStaffName(staffName);
		const existing = await this.prismaService.staffColorMap.findUnique({
			where: { shopId_staffName: { shopId: requireCurrentShopId(), staffName: normalizedStaffName } },
		});
		if (existing?.color) {
			return existing.color;
		}

		return this.defaultColorForStaffName(normalizedStaffName);
	}

	private normalizeStaffName(staffName: string) {
		const normalized = staffName.trim().toLowerCase();
		return normalized || 'employee-fallback';
	}

	private defaultColorForStaffName(staffName: string) {
		let hash = 2166136261;
		for (let index = 0; index < staffName.length; index += 1) {
			hash ^= staffName.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}

		const hue = Math.abs(hash) % 360;
		return `hsl(${hue} 70% 56%)`;
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
