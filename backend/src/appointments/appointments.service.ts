import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Appointment, AppointmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

type PrismaClientOrTx = PrismaService | Prisma.TransactionClient;
import { AuditService } from '../audit/audit.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { ListAppointmentsDto } from './dto/list-appointments.dto';
import { MoveAppointmentDto } from './dto/move-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AppointmentsEventsService } from './appointments-events.service';
import { getPendingAssignmentEmployeeUsername } from '../common/pending-assignment';

@Injectable()
export class AppointmentsService {
	constructor(
		private readonly prismaService: PrismaService,
		private readonly auditService: AuditService,
		private readonly appointmentsEventsService: AppointmentsEventsService,
	) {}

	async listAppointments(query: ListAppointmentsDto) {
		const rangeStart = query.rangeStart ? new Date(query.rangeStart) : undefined;
		const rangeEnd = query.rangeEnd ? new Date(query.rangeEnd) : undefined;

		const appointments = await this.prismaService.appointment.findMany({
			where: {
				deletedAt: null,
				...(query.employeeId ? { employeeId: query.employeeId } : {}),
				...(query.groupId ? { groupId: query.groupId } : {}),
				...(rangeStart && rangeEnd
					? {
							startAt: { lt: rangeEnd },
							endAt: { gt: rangeStart },
						}
					: {}),
			},
			orderBy: { startAt: 'asc' },
		});

		return appointments.map((appointment) =>
			this.mapAppointmentForResponse(appointment),
		);
	}

	async findCustomerByPhone(phone: string) {
		if (!/^\d{10}$/.test(phone)) {
			throw new BadRequestException('phone must contain exactly 10 digits');
		}

		const appointment = await this.prismaService.appointment.findFirst({
			where: {
				phone,
				deletedAt: null,
				OR: [{ customerName: { not: null } }, { note: { not: null } }],
			},
			orderBy: { createdAt: 'desc' },
			select: { customerName: true, note: true },
		});

		return appointment ?? { customerName: null, note: null };
	}

	async createAppointment(dto: CreateAppointmentDto) {
		if (!dto.createdById) {
			throw new BadRequestException('createdById is required');
		}

		if (dto.employeeIds || dto.partySize) {
			return this.createGroupAppointment(dto);
		}

		if (!dto.employeeId) {
			throw new BadRequestException('employeeId is required');
		}

		const startAt = new Date(dto.startAt);
		const endAt = new Date(dto.endAt);
		this.validateTimeRange(startAt, endAt);
		this.validateTimeNotInPast(startAt, dto.userRole);
		if (!(await this.isPendingAssignmentEmployee(dto.employeeId))) {
			await this.assertNoTimeConflict(dto.employeeId, startAt, endAt);
		}

		const employeeSnapshot = await this.getEmployeeSnapshot(dto.employeeId);
		const appointment = await this.prismaService.appointment.create({
			data: {
				employeeId: dto.employeeId,
				employeeDisplayName: employeeSnapshot.employeeDisplayName,
				employeeColor: employeeSnapshot.employeeColor,
				startAt,
				endAt,
				phone: dto.phone,
				price: dto.price ? this.parseUsdToCents(dto.price) : 0,
				customerName: dto.customerName,
				serviceName: dto.serviceName,
				note: dto.note,
				createdById: dto.createdById,
				updatedById: dto.createdById,
			},
		});

		await this.auditService.recordAppointmentChange({
			actorUserId: dto.createdById,
			action: 'appointment.create',
			entityId: appointment.id,
			beforePayload: null,
			afterPayload: this.toAuditPayload(appointment),
		});

		this.appointmentsEventsService.publishAppointmentsChanged(dto.createdById);

		return this.mapAppointmentForResponse(appointment);
	}

	// Creates one appointment record per selected employee plus "pending" filler records for the
	// remaining headcount, all linked by a shared groupId (see docs/pending-assignment-logic.md).
	private async createGroupAppointment(dto: CreateAppointmentDto) {
		const createdById = dto.createdById!;
		const startAt = new Date(dto.startAt);
		const endAt = new Date(dto.endAt);
		this.validateTimeRange(startAt, endAt);
		this.validateTimeNotInPast(startAt, dto.userRole);

		const employeeIds = Array.from(new Set(dto.employeeIds ?? []));
		const partySize = dto.partySize ?? Math.max(employeeIds.length, 1);

		if (employeeIds.length > partySize) {
			throw new BadRequestException('Selected employees cannot exceed party size');
		}

		const pendingCount = partySize - employeeIds.length;
		if (employeeIds.length === 0 && pendingCount === 0) {
			throw new BadRequestException('At least one employee or pending slot is required');
		}

		const pendingEmployeeId = pendingCount > 0 ? await this.getPendingAssignmentEmployeeId() : null;
		if (pendingCount > 0 && !pendingEmployeeId) {
			throw new BadRequestException('Pending assignment employee is not configured');
		}

		const groupId = employeeIds.length + pendingCount > 1 ? randomUUID() : null;

		const created = await this.prismaService.$transaction(async (tx) => {
			const records: Appointment[] = [];

			for (const employeeId of employeeIds) {
				await this.assertNoTimeConflict(employeeId, startAt, endAt, undefined, tx);
				const snapshot = await this.getEmployeeSnapshot(employeeId, tx);
				records.push(
					await tx.appointment.create({
						data: {
							employeeId,
							employeeDisplayName: snapshot.employeeDisplayName,
							employeeColor: snapshot.employeeColor,
							startAt,
							endAt,
							phone: dto.phone,
							price: dto.price ? this.parseUsdToCents(dto.price) : 0,
							customerName: dto.customerName,
							serviceName: dto.serviceName,
							note: dto.note,
							createdById,
							updatedById: createdById,
							groupId,
						},
					}),
				);
			}

			for (let index = 0; index < pendingCount; index += 1) {
				const snapshot = await this.getEmployeeSnapshot(pendingEmployeeId!, tx);
				records.push(
					await tx.appointment.create({
						data: {
							employeeId: pendingEmployeeId!,
							employeeDisplayName: snapshot.employeeDisplayName,
							employeeColor: snapshot.employeeColor,
							startAt,
							endAt,
							phone: dto.phone,
							price: dto.price ? this.parseUsdToCents(dto.price) : 0,
							customerName: dto.customerName,
							serviceName: dto.serviceName,
							note: dto.note,
							createdById,
							updatedById: createdById,
							groupId,
						},
					}),
				);
			}

			return records;
		});

		for (const appointment of created) {
			await this.auditService.recordAppointmentChange({
				actorUserId: createdById,
				action: 'appointment.create',
				entityId: appointment.id,
				beforePayload: null,
				afterPayload: this.toAuditPayload(appointment),
			});
		}

		this.appointmentsEventsService.publishAppointmentsChanged(createdById);

		return {
			groupId,
			pendingCount,
			appointments: created.map((appointment) => this.mapAppointmentForResponse(appointment)),
		};
	}

	async updateAppointment(id: string, dto: UpdateAppointmentDto) {
		if (!dto.updatedById) {
			throw new BadRequestException('updatedById is required');
		}

		const existing = await this.getActiveAppointmentOrThrow(id);

		if (existing.groupId || dto.employeeIds || dto.partySize) {
			return this.updateGroupAppointment(dto, existing);
		}

		const nextStart = dto.startAt ? new Date(dto.startAt) : existing.startAt;
		const nextEnd = dto.endAt ? new Date(dto.endAt) : existing.endAt;
		const nextEmployeeId = dto.employeeId ?? existing.employeeId;

		this.validateTimeRange(nextStart, nextEnd);
		this.validateTimeNotInPast(nextStart, dto.userRole);
		if (!(await this.isPendingAssignmentEmployee(nextEmployeeId))) {
			await this.assertNoTimeConflict(nextEmployeeId, nextStart, nextEnd, id);
		}

		const employeeSnapshot = await this.getEmployeeSnapshot(nextEmployeeId);
		const updated = await this.prismaService.appointment.update({
			where: { id },
			data: {
				employeeId: nextEmployeeId,
				employeeDisplayName: employeeSnapshot.employeeDisplayName ?? existing.employeeDisplayName ?? null,
				employeeColor: employeeSnapshot.employeeColor ?? existing.employeeColor ?? null,
				startAt: nextStart,
				endAt: nextEnd,
				phone: dto.phone ?? existing.phone,
				price: dto.price ? this.parseUsdToCents(dto.price) : existing.price,
				customerName: dto.customerName ?? existing.customerName,
				serviceName: dto.serviceName ?? existing.serviceName,
				note: dto.note ?? existing.note,
				status: dto.status ?? existing.status,
				updatedById: dto.updatedById,
			},
		});

		await this.auditService.recordAppointmentChange({
			actorUserId: dto.updatedById,
			action: 'appointment.update',
			entityId: updated.id,
			beforePayload: this.toAuditPayload(existing),
			afterPayload: this.toAuditPayload(updated),
		});

		this.appointmentsEventsService.publishAppointmentsChanged(dto.updatedById);

		return this.mapAppointmentForResponse(updated);
	}

	// Option A (linked edit): shared fields update every active member of the group; changing
	// employeeIds/partySize adds, removes (soft-cancels) or backfills "pending" records to match.
	private async updateGroupAppointment(dto: UpdateAppointmentDto, anchor: Appointment) {
		const updatedById = dto.updatedById!;
		const nextStart = dto.startAt ? new Date(dto.startAt) : anchor.startAt;
		const nextEnd = dto.endAt ? new Date(dto.endAt) : anchor.endAt;
		this.validateTimeRange(nextStart, nextEnd);
		this.validateTimeNotInPast(nextStart, dto.userRole);

		const pendingEmployeeId = await this.getPendingAssignmentEmployeeId();

		const currentMembers = anchor.groupId
			? await this.prismaService.appointment.findMany({
					where: { groupId: anchor.groupId, deletedAt: null },
				})
			: [anchor];

		const currentReal = currentMembers.filter((member) => member.employeeId !== pendingEmployeeId);
		const currentPending = currentMembers.filter((member) => member.employeeId === pendingEmployeeId);

		const employeeIds = Array.from(new Set(dto.employeeIds ?? currentReal.map((member) => member.employeeId)));
		const partySize = dto.partySize ?? currentMembers.length;

		if (employeeIds.length > partySize) {
			throw new BadRequestException('Selected employees cannot exceed party size');
		}

		const pendingCount = partySize - employeeIds.length;
		if (pendingCount > 0 && !pendingEmployeeId) {
			throw new BadRequestException('Pending assignment employee is not configured');
		}

		const groupId = anchor.groupId ?? (partySize > 1 ? randomUUID() : null);

		const keepReal = currentReal.filter((member) => employeeIds.includes(member.employeeId));
		const removeReal = currentReal.filter((member) => !employeeIds.includes(member.employeeId));
		const addRealEmployeeIds = employeeIds.filter(
			(employeeId) => !currentReal.some((member) => member.employeeId === employeeId),
		);

		const pendingDiff = pendingCount - currentPending.length;
		const removePending = pendingDiff < 0 ? currentPending.slice(0, Math.abs(pendingDiff)) : [];
		const keepPending = currentPending.filter((member) => !removePending.includes(member));
		const addPendingCount = pendingDiff > 0 ? pendingDiff : 0;

		const sharedData = {
			startAt: nextStart,
			endAt: nextEnd,
			phone: dto.phone ?? anchor.phone,
			price: dto.price ? this.parseUsdToCents(dto.price) : anchor.price,
			customerName: dto.customerName ?? anchor.customerName,
			serviceName: dto.serviceName ?? anchor.serviceName,
			note: dto.note ?? anchor.note,
			status: dto.status ?? anchor.status,
			updatedById,
		};

		const updated = await this.prismaService.$transaction(async (tx) => {
			const records: Appointment[] = [];

			for (const member of keepReal) {
				await this.assertNoTimeConflict(member.employeeId, nextStart, nextEnd, member.id, tx);
				records.push(
					await tx.appointment.update({
						where: { id: member.id },
						data: { ...sharedData, groupId },
					}),
				);
			}

			for (const member of removeReal) {
				records.push(
					await tx.appointment.update({
						where: { id: member.id },
						data: { status: AppointmentStatus.CANCELLED, deletedAt: new Date(), updatedById },
					}),
				);
			}

			for (const employeeId of addRealEmployeeIds) {
				await this.assertNoTimeConflict(employeeId, nextStart, nextEnd, undefined, tx);
				const snapshot = await this.getEmployeeSnapshot(employeeId, tx);
				records.push(
					await tx.appointment.create({
						data: {
							...sharedData,
							employeeId,
							employeeDisplayName: snapshot.employeeDisplayName,
							employeeColor: snapshot.employeeColor,
							createdById: updatedById,
							groupId,
						},
					}),
				);
			}

			for (const member of keepPending) {
				records.push(
					await tx.appointment.update({
						where: { id: member.id },
						data: { ...sharedData, groupId },
					}),
				);
			}

			for (const member of removePending) {
				records.push(
					await tx.appointment.update({
						where: { id: member.id },
						data: { status: AppointmentStatus.CANCELLED, deletedAt: new Date(), updatedById },
					}),
				);
			}

			for (let index = 0; index < addPendingCount; index += 1) {
				const snapshot = await this.getEmployeeSnapshot(pendingEmployeeId!, tx);
				records.push(
					await tx.appointment.create({
						data: {
							...sharedData,
							employeeId: pendingEmployeeId!,
							employeeDisplayName: snapshot.employeeDisplayName,
							employeeColor: snapshot.employeeColor,
							createdById: updatedById,
							groupId,
						},
					}),
				);
			}

			return records;
		});

		for (const appointment of updated) {
			const before = currentMembers.find((member) => member.id === appointment.id) ?? null;
			await this.auditService.recordAppointmentChange({
				actorUserId: updatedById,
				action: before ? 'appointment.update' : 'appointment.create',
				entityId: appointment.id,
				beforePayload: before ? this.toAuditPayload(before) : null,
				afterPayload: this.toAuditPayload(appointment),
			});
		}

		this.appointmentsEventsService.publishAppointmentsChanged(updatedById);

		return {
			groupId,
			pendingCount,
			appointments: updated
				.filter((appointment) => appointment.deletedAt === null)
				.map((appointment) => this.mapAppointmentForResponse(appointment)),
		};
	}

	async cancelAppointment(id: string, cancelledById: string) {
		const existing = await this.getActiveAppointmentOrThrow(id);

		const cancelled = await this.prismaService.appointment.update({
			where: { id },
			data: {
				status: AppointmentStatus.CANCELLED,
				updatedById: cancelledById,
			},
		});

		await this.auditService.recordAppointmentChange({
			actorUserId: cancelledById,
			action: 'appointment.cancel',
			entityId: cancelled.id,
			beforePayload: this.toAuditPayload(existing),
			afterPayload: this.toAuditPayload(cancelled),
		});

		this.appointmentsEventsService.publishAppointmentsChanged(cancelledById);

		return { success: true, id: cancelled.id };
	}

	async deleteAppointment(id: string, deletedById: string) {
		const existing = await this.getActiveAppointmentOrThrow(id);

		const deleted = await this.prismaService.appointment.update({
			where: { id },
			data: {
				status: AppointmentStatus.CANCELLED,
				deletedAt: new Date(),
				updatedById: deletedById,
			},
		});

		await this.auditService.recordAppointmentChange({
			actorUserId: deletedById,
			action: 'appointment.delete',
			entityId: deleted.id,
			beforePayload: this.toAuditPayload(existing),
			afterPayload: this.toAuditPayload(deleted),
		});

		this.appointmentsEventsService.publishAppointmentsChanged(deletedById);

		return { success: true, id: deleted.id };
	}

	moveAppointment(id: string, dto: MoveAppointmentDto) {
		return this.updateAppointment(id, {
			startAt: dto.startAt,
			endAt: dto.endAt,
			employeeId: dto.employeeId,
			updatedById: dto.updatedById,
		});
	}

	private async getActiveAppointmentOrThrow(id: string) {
		const appointment = await this.prismaService.appointment.findFirst({
			where: { id, deletedAt: null },
		});

		if (!appointment) {
			throw new NotFoundException('Appointment not found');
		}

		return appointment;
	}

	private async assertNoTimeConflict(
		employeeId: string,
		startAt: Date,
		endAt: Date,
		excludeId?: string,
		client: PrismaClientOrTx = this.prismaService,
	) {
		const conflict = await client.appointment.findFirst({
			where: {
				employeeId,
				status: AppointmentStatus.SCHEDULED,
				deletedAt: null,
				...(excludeId ? { id: { not: excludeId } } : {}),
				startAt: { lt: endAt },
				endAt: { gt: startAt },
			},
			select: { id: true },
		});

		if (conflict) {
			throw new ConflictException(
				'This time overlaps an existing appointment for the same employee. Please choose a different slot.',
			);
		}
	}

	private async isPendingAssignmentEmployee(employeeId: string) {
		const pendingUsername = getPendingAssignmentEmployeeUsername();
		const user = await this.prismaService.user.findFirst({
			where: {
				id: employeeId,
				username: pendingUsername,
				deletedAt: null,
			},
			select: { id: true },
		});

		return Boolean(user);
	}

	private async getPendingAssignmentEmployeeId() {
		const pendingUsername = getPendingAssignmentEmployeeUsername();
		const user = await this.prismaService.user.findFirst({
			where: { username: pendingUsername, deletedAt: null },
			select: { id: true },
		});

		return user?.id ?? null;
	}

	private async getEmployeeSnapshot(employeeId: string, client: PrismaClientOrTx = this.prismaService) {
		const user = await client.user.findFirst({
			where: { id: employeeId, deletedAt: null },
			select: { displayName: true, username: true },
		});

		return {
			employeeDisplayName: user?.displayName ?? user?.username ?? null,
			employeeColor: user?.displayName ? await this.getStaffColor(user.displayName) : null,
		};
	}

	private async getStaffColor(staffName: string) {
		const normalizedStaffName = this.normalizeStaffName(staffName);
		const existing = await this.prismaService.staffColorMap.findUnique({
			where: { staffName: normalizedStaffName },
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

	private validateTimeRange(startAt: Date, endAt: Date) {
		if (startAt >= endAt) {
			throw new BadRequestException('startAt must be earlier than endAt');
		}
	}

	private validateTimeNotInPast(startAt: Date, userRole?: string) {
		// Only enforce past time check for non-admin users
		if (userRole === 'ADMIN') {
			return;
		}

		const now = new Date();
		if (startAt < now) {
			throw new BadRequestException('Cannot schedule appointment to a past time');
		}
	}

	private toAuditPayload(appointment: Appointment) {
		return {
			id: appointment.id,
			employeeId: appointment.employeeId,
			groupId: appointment.groupId,
			startAt: appointment.startAt,
			endAt: appointment.endAt,
			phone: appointment.phone,
			price: this.formatCentsToUsd(appointment.price),
			customerName: appointment.customerName,
			serviceName: appointment.serviceName,
			status: appointment.status,
			note: appointment.note,
			updatedById: appointment.updatedById,
			updatedAt: appointment.updatedAt,
			deletedAt: appointment.deletedAt,
		};
	}

	private parseUsdToCents(value: string) {
		const [dollars, cents] = value.split('.');
		const normalizedDollars = Number(dollars);
		const normalizedCents = Number(cents);

		if (!Number.isInteger(normalizedDollars) || !Number.isInteger(normalizedCents)) {
			throw new BadRequestException('price must be a valid USD amount with two decimals');
		}

		return normalizedDollars * 100 + normalizedCents;
	}

	private formatCentsToUsd(value: number) {
		return (value / 100).toFixed(2);
	}

	private mapAppointmentForResponse(appointment: Appointment) {
		return {
			id: appointment.id,
			employeeId: appointment.employeeId,
			groupId: appointment.groupId,
			employeeDisplayName: appointment.employeeDisplayName,
			employeeColor: appointment.employeeColor,
			startAt: appointment.startAt,
			endAt: appointment.endAt,
			phone: appointment.phone,
			price: this.formatCentsToUsd(appointment.price),
			customerName: appointment.customerName,
			serviceName: appointment.serviceName,
			note: appointment.note,
			status: appointment.status,
			createdById: appointment.createdById,
			updatedById: appointment.updatedById,
			createdAt: appointment.createdAt,
			updatedAt: appointment.updatedAt,
			deletedAt: appointment.deletedAt,
		};
	}
}
