import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserPasswordDto } from './dto/update-user-password.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

@Injectable()
export class UsersService {
	constructor(
		private readonly prismaService: PrismaService,
		private readonly auditService: AuditService,
	) {}

	listUsers() {
		return this.prismaService.user.findMany({
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
	}

	async createUser(dto: CreateUserDto, actorUserId: string) {
		if (dto.role !== UserRole.EMPLOYEE) {
			throw new BadRequestException('Only EMPLOYEE accounts can be created from this endpoint.');
		}

		const passwordHash = await bcrypt.hash(dto.password, 10);
		const created = await this.prismaService.user.create({
			data: {
				username: dto.username,
				passwordHash,
				displayName: dto.displayName ?? dto.username,
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

		await this.auditService.recordUserManagementChange({
			actorUserId,
			action: 'user.status.update',
			entityId: updated.id,
			beforePayload: this.toAuditPayload(existing),
			afterPayload: this.toAuditPayload(updated),
		});

		return updated;
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

		await this.auditService.recordUserManagementChange({
			actorUserId,
			action: 'user.password.update',
			entityId: updated.id,
			beforePayload: this.toAuditPayload(existing),
			afterPayload: this.toAuditPayload(updated),
		});

		return updated;
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

		await this.auditService.recordUserManagementChange({
			actorUserId,
			action: 'user.remove',
			entityId: removed.id,
			beforePayload: this.toAuditPayload(existing),
			afterPayload: this.toAuditPayload(removed),
		});

		return removed;
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

	private toAuditPayload(user: {
		id: string;
		username: string;
		displayName: string;
		role: UserRole;
		status: UserStatus;
		createdAt?: Date;
		updatedAt?: Date;
		deletedAt?: Date | null;
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
		};
	}
}
