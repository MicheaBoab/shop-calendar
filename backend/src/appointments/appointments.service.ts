import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { Appointment, AppointmentStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { ListAppointmentsDto } from './dto/list-appointments.dto';
import { MoveAppointmentDto } from './dto/move-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AppointmentsEventsService } from './appointments-events.service';

const PENDING_EMPLOYEE_USERNAME = process.env.PENDING_EMPLOYEE_USERNAME ?? 'pending_assignment';

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

	async createAppointment(dto: CreateAppointmentDto) {
		if (!dto.createdById) {
			throw new BadRequestException('createdById is required');
		}

		const startAt = new Date(dto.startAt);
		const endAt = new Date(dto.endAt);
		this.validateTimeRange(startAt, endAt);
		if (!(await this.isPendingAssignmentEmployee(dto.employeeId))) {
			await this.assertNoTimeConflict(dto.employeeId, startAt, endAt);
		}

		const appointment = await this.prismaService.appointment.create({
			data: {
				employeeId: dto.employeeId,
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

	async updateAppointment(id: string, dto: UpdateAppointmentDto) {
		if (!dto.updatedById) {
			throw new BadRequestException('updatedById is required');
		}

		const existing = await this.getActiveAppointmentOrThrow(id);

		const nextStart = dto.startAt ? new Date(dto.startAt) : existing.startAt;
		const nextEnd = dto.endAt ? new Date(dto.endAt) : existing.endAt;
		const nextEmployeeId = dto.employeeId ?? existing.employeeId;

		this.validateTimeRange(nextStart, nextEnd);
		if (!(await this.isPendingAssignmentEmployee(nextEmployeeId))) {
			await this.assertNoTimeConflict(nextEmployeeId, nextStart, nextEnd, id);
		}

		const updated = await this.prismaService.appointment.update({
			where: { id },
			data: {
				employeeId: nextEmployeeId,
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
	) {
		const conflict = await this.prismaService.appointment.findFirst({
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
		const user = await this.prismaService.user.findFirst({
			where: {
				id: employeeId,
				username: PENDING_EMPLOYEE_USERNAME,
				deletedAt: null,
			},
			select: { id: true },
		});

		return Boolean(user);
	}

	private validateTimeRange(startAt: Date, endAt: Date) {
		if (startAt >= endAt) {
			throw new BadRequestException('startAt must be earlier than endAt');
		}
	}

	private toAuditPayload(appointment: Appointment) {
		return {
			id: appointment.id,
			employeeId: appointment.employeeId,
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
