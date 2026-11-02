import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Appointment, AppointmentStatus, Prisma, UserRole } from '@prisma/client';
import { SHOP_SCOPED_PRISMA } from '../common/prisma/prisma.module';
import type { ShopScopedPrismaClient } from '../common/prisma/prisma.module';
import { requireCurrentShopId } from '../common/shop-context/shop-context';

type PrismaClientOrTx = Prisma.TransactionClient;
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { ListAppointmentsDto } from './dto/list-appointments.dto';
import { MoveAppointmentDto } from './dto/move-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AppointmentsEventsService } from './appointments-events.service';
import { getPendingAssignmentEmployeeUsernameForShop } from '../common/pending-assignment';
import { StaffColorsService } from '../staff-colors/staff-colors.service';

type AppointmentAuditAction =
  | 'appointment.create'
  | 'appointment.update'
  | 'appointment.move'
  | 'appointment.cancel'
  | 'appointment.delete';

@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(SHOP_SCOPED_PRISMA)
    private readonly prismaService: ShopScopedPrismaClient,
    private readonly auditService: AuditService,
    private readonly appointmentsEventsService: AppointmentsEventsService,
    private readonly staffColors: StaffColorsService,
  ) {}

  async listAppointments(query: ListAppointmentsDto) {
    const rangeStart = query.rangeStart
      ? new Date(query.rangeStart)
      : undefined;
    const rangeEnd = query.rangeEnd ? new Date(query.rangeEnd) : undefined;

    const appointments = await this.prismaService.appointment.findMany({
      where: {
        shopId: requireCurrentShopId(),
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
        shopId: requireCurrentShopId(),
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
    const auditContext = await this.auditService.createAuditContext(
      dto.createdById,
    );
    const groupId = randomUUID();
    const appointment = await this.runConflictCheckedAppointmentTransaction(
      async (tx) => {
        if (!(await this.isPendingAssignmentEmployee(dto.employeeId!, tx))) {
          await this.assertNoTimeConflict(
            dto.employeeId!,
            startAt,
            endAt,
            undefined,
            tx,
          );
        }
        const employeeSnapshot = await this.getEmployeeSnapshot(
          dto.employeeId!,
          tx,
        );
        const created = await tx.appointment.create({
          data: {
            shopId: requireCurrentShopId(),
            employeeId: dto.employeeId!,
            employeeDisplayName: employeeSnapshot.employeeDisplayName,
            employeeColor: employeeSnapshot.employeeColor,
            startAt,
            endAt,
            phone: dto.phone,
            price: dto.price ? this.parseUsdToCents(dto.price) : 0,
            customerName: dto.customerName,
            serviceName: dto.serviceName,
            note: dto.note,
            createdById: dto.createdById!,
            updatedById: dto.createdById!,
            groupId,
          },
        });
        await this.recordAppointmentGroupChange({
          actorUserId: dto.createdById!,
          action: 'appointment.create',
          groupId,
          beforePayload: null,
          afterAppointments: [created],
          context: auditContext,
          writer: tx,
        });
        return created;
      },
    );

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

    const pendingEmployeeId = await this.getPendingAssignmentEmployeeId();
    const employeeIds = this.normalizeGroupEmployeeIds(
      dto.employeeIds ?? [],
      pendingEmployeeId,
    );
    const partySize = dto.partySize ?? Math.max(employeeIds.length, 1);

    if (employeeIds.length > partySize) {
      throw new BadRequestException(
        'Selected employees cannot exceed party size',
      );
    }

    const pendingCount = partySize - employeeIds.length;
    if (employeeIds.length === 0 && pendingCount === 0) {
      throw new BadRequestException(
        'At least one employee or pending slot is required',
      );
    }

    if (pendingCount > 0 && !pendingEmployeeId) {
      throw new BadRequestException(
        'Pending assignment employee is not configured',
      );
    }

    const groupId = randomUUID();
    const shopId = requireCurrentShopId();
    const auditContext =
      await this.auditService.createAuditContext(createdById);

    const created = await this.runConflictCheckedAppointmentTransaction(
      async (tx) => {
        const records: Appointment[] = [];

        for (const employeeId of employeeIds) {
          await this.assertNoTimeConflict(
            employeeId,
            startAt,
            endAt,
            undefined,
            tx,
          );
          const snapshot = await this.getEmployeeSnapshot(employeeId, tx);
          records.push(
            await tx.appointment.create({
              data: {
                shopId,
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
          const snapshot = await this.getEmployeeSnapshot(
            pendingEmployeeId!,
            tx,
          );
          records.push(
            await tx.appointment.create({
              data: {
                shopId,
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

        await this.recordAppointmentGroupChange({
          actorUserId: createdById,
          action: 'appointment.create',
          groupId,
          beforePayload: null,
          afterAppointments: records,
          context: auditContext,
          writer: tx,
        });
        return records;
      },
    );

    this.appointmentsEventsService.publishAppointmentsChanged(createdById);

    return {
      groupId,
      pendingCount,
      appointments: created.map((appointment) =>
        this.mapAppointmentForResponse(appointment),
      ),
    };
  }

  async updateAppointment(
    id: string,
    dto: UpdateAppointmentDto,
    auditAction: AppointmentAuditAction = 'appointment.update',
  ) {
    if (!dto.updatedById) {
      throw new BadRequestException('updatedById is required');
    }

    const existing = await this.getActiveAppointmentOrThrow(id);
    this.assertNotCancelled(existing);

    if (existing.groupId || dto.employeeIds || dto.partySize) {
      return this.updateGroupAppointment(dto, existing, auditAction);
    }

    const auditContext = await this.auditService.createAuditContext(
      dto.updatedById,
    );
    const updated = await this.runConflictCheckedAppointmentTransaction(
      async (tx) => {
        const current = await tx.appointment.findFirst({
          where: { id, shopId: requireCurrentShopId(), deletedAt: null },
        });
        if (!current) throw new NotFoundException('Appointment not found');
        this.assertNotCancelled(current);

        const nextStart = dto.startAt ? new Date(dto.startAt) : current.startAt;
        const nextEnd = dto.endAt ? new Date(dto.endAt) : current.endAt;
        const nextEmployeeId = dto.employeeId ?? current.employeeId;
        this.validateTimeRange(nextStart, nextEnd);
        if (!(await this.isPendingAssignmentEmployee(nextEmployeeId, tx))) {
          await this.assertNoTimeConflict(
            nextEmployeeId,
            nextStart,
            nextEnd,
            id,
            tx,
          );
        }

        const employeeSnapshot =
          nextEmployeeId === current.employeeId
            ? {
                employeeDisplayName: current.employeeDisplayName,
                employeeColor: current.employeeColor,
              }
            : await this.getEmployeeSnapshot(nextEmployeeId, tx);
        const changed = await tx.appointment.update({
          where: { id, shopId: requireCurrentShopId() },
          data: {
            employeeId: nextEmployeeId,
            employeeDisplayName:
              employeeSnapshot.employeeDisplayName ??
              current.employeeDisplayName ??
              null,
            employeeColor:
              employeeSnapshot.employeeColor ?? current.employeeColor ?? null,
            startAt: nextStart,
            endAt: nextEnd,
            phone: dto.phone ?? current.phone,
            price: dto.price ? this.parseUsdToCents(dto.price) : current.price,
            customerName: dto.customerName ?? current.customerName,
            serviceName: dto.serviceName ?? current.serviceName,
            note: dto.note ?? current.note,
            status: dto.status ?? current.status,
            updatedById: dto.updatedById,
          },
        });
        await this.recordAppointmentGroupChange({
          actorUserId: dto.updatedById!,
          action: auditAction,
          groupId: changed.groupId ?? changed.id,
          beforeAppointments: [current],
          afterAppointments: [changed],
          context: auditContext,
          writer: tx,
        });
        return changed;
      },
    );

    this.appointmentsEventsService.publishAppointmentsChanged(dto.updatedById);

    return this.mapAppointmentForResponse(updated);
  }

  // Option A (linked edit): shared fields update every active member of the group; changing
  // employeeIds/partySize adds, removes (soft-cancels) or backfills "pending" records to match.
  private async updateGroupAppointment(
    dto: UpdateAppointmentDto,
    anchor: Appointment,
    auditAction: AppointmentAuditAction,
  ) {
    const updatedById = dto.updatedById!;
    const pendingEmployeeId = await this.getPendingAssignmentEmployeeId();
    const shopId = requireCurrentShopId();
    const groupId = anchor.groupId ?? randomUUID();
    const auditContext =
      await this.auditService.createAuditContext(updatedById);
    const result = await this.runConflictCheckedAppointmentTransaction(
      async (tx) => {
        const currentMembers = anchor.groupId
          ? await tx.appointment.findMany({
              where: { shopId, groupId: anchor.groupId, deletedAt: null },
            })
          : await tx.appointment.findMany({
              where: { id: anchor.id, shopId, deletedAt: null },
            });
        if (currentMembers.length === 0) {
          throw new NotFoundException('Appointment not found');
        }
        const currentAnchor =
          currentMembers.find((member) => member.id === anchor.id) ??
          currentMembers[0];
        this.assertNotCancelled(currentAnchor);
        const nextStart = dto.startAt
          ? new Date(dto.startAt)
          : currentAnchor.startAt;
        const nextEnd = dto.endAt ? new Date(dto.endAt) : currentAnchor.endAt;
        this.validateTimeRange(nextStart, nextEnd);

        const currentReal = currentMembers.filter(
          (member) => member.employeeId !== pendingEmployeeId,
        );
        const currentPending = currentMembers.filter(
          (member) => member.employeeId === pendingEmployeeId,
        );
        const requestedEmployeeIds =
          dto.employeeIds ??
          (dto.employeeId
            ? currentReal.map((member) =>
                member.id === currentAnchor.id
                  ? dto.employeeId!
                  : member.employeeId,
              )
            : currentReal.map((member) => member.employeeId));
        const employeeIds = this.normalizeGroupEmployeeIds(
          requestedEmployeeIds,
          pendingEmployeeId,
        );
        const partySize = dto.partySize ?? currentMembers.length;
        if (employeeIds.length > partySize) {
          throw new BadRequestException(
            'Selected employees cannot exceed party size',
          );
        }
        const pendingCount = partySize - employeeIds.length;
        if (pendingCount > 0 && !pendingEmployeeId) {
          throw new BadRequestException(
            'Pending assignment employee is not configured',
          );
        }

        const keepReal = currentReal.filter((member) =>
          employeeIds.includes(member.employeeId),
        );
        const removeReal = currentReal.filter(
          (member) => !employeeIds.includes(member.employeeId),
        );
        const addRealEmployeeIds = employeeIds.filter(
          (employeeId) =>
            !currentReal.some((member) => member.employeeId === employeeId),
        );
        const pendingDiff = pendingCount - currentPending.length;
        const removePending =
          pendingDiff < 0 ? currentPending.slice(0, Math.abs(pendingDiff)) : [];
        const keepPending = currentPending.filter(
          (member) => !removePending.includes(member),
        );
        const addPendingCount = pendingDiff > 0 ? pendingDiff : 0;
        const sharedData = {
          startAt: nextStart,
          endAt: nextEnd,
          phone: dto.phone ?? currentAnchor.phone,
          price: dto.price
            ? this.parseUsdToCents(dto.price)
            : currentAnchor.price,
          customerName: dto.customerName ?? currentAnchor.customerName,
          serviceName: dto.serviceName ?? currentAnchor.serviceName,
          note: dto.note ?? currentAnchor.note,
          status: dto.status ?? currentAnchor.status,
          updatedById,
        };
        const records: Appointment[] = [];

        for (const member of keepReal) {
          await this.assertNoTimeConflict(
            member.employeeId,
            nextStart,
            nextEnd,
            member.id,
            tx,
          );
          records.push(
            await tx.appointment.update({
              where: { id: member.id },
              data: {
                ...sharedData,
                price: dto.price ? sharedData.price : member.price,
                employeeDisplayName: member.employeeDisplayName,
                employeeColor: member.employeeColor,
                groupId,
              },
            }),
          );
        }

        for (const member of removeReal) {
          records.push(
            await tx.appointment.update({
              where: { id: member.id },
              data: {
                status: AppointmentStatus.CANCELLED,
                deletedAt: new Date(),
                updatedById,
              },
            }),
          );
        }

        for (const employeeId of addRealEmployeeIds) {
          await this.assertNoTimeConflict(
            employeeId,
            nextStart,
            nextEnd,
            undefined,
            tx,
          );
          const snapshot = await this.getEmployeeSnapshot(employeeId, tx);
          records.push(
            await tx.appointment.create({
              data: {
                ...sharedData,
                shopId,
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
              data: {
                ...sharedData,
                price: dto.price ? sharedData.price : member.price,
                groupId,
              },
            }),
          );
        }

        for (const member of removePending) {
          records.push(
            await tx.appointment.update({
              where: { id: member.id },
              data: {
                status: AppointmentStatus.CANCELLED,
                deletedAt: new Date(),
                updatedById,
              },
            }),
          );
        }

        for (let index = 0; index < addPendingCount; index += 1) {
          const snapshot = await this.getEmployeeSnapshot(
            pendingEmployeeId!,
            tx,
          );
          records.push(
            await tx.appointment.create({
              data: {
                ...sharedData,
                shopId,
                employeeId: pendingEmployeeId!,
                employeeDisplayName: snapshot.employeeDisplayName,
                employeeColor: snapshot.employeeColor,
                createdById: updatedById,
                groupId,
              },
            }),
          );
        }

        await this.recordAppointmentGroupChange({
          actorUserId: updatedById,
          action: auditAction,
          groupId,
          beforeAppointments: currentMembers,
          afterAppointments: records,
          context: auditContext,
          writer: tx,
        });
        return { records, pendingCount };
      },
    );

    this.appointmentsEventsService.publishAppointmentsChanged(updatedById);

    return {
      groupId,
      pendingCount: result.pendingCount,
      appointments: result.records
        .filter((appointment) => appointment.deletedAt === null)
        .map((appointment) => this.mapAppointmentForResponse(appointment)),
    };
  }

  async cancelAppointment(id: string, cancelledById: string) {
    const existing = await this.getActiveAppointmentOrThrow(id);
    this.assertNotCancelled(existing);
    const groupId = existing.groupId ?? existing.id;
    const auditContext =
      await this.auditService.createAuditContext(cancelledById);
    const cancelled = await this.prismaService.$transaction(async (tx) => {
      const current = await tx.appointment.findFirst({
        where: { id, shopId: requireCurrentShopId(), deletedAt: null },
      });
      if (!current) throw new NotFoundException('Appointment not found');
      this.assertNotCancelled(current);
      const currentMembers = await this.getActiveGroupMembers(
        current,
        tx as unknown as Prisma.TransactionClient,
      );
      const records: Appointment[] = [];

      for (const member of currentMembers) {
        records.push(
          await tx.appointment.update({
            where: { id: member.id },
            data: {
              status: AppointmentStatus.CANCELLED,
              updatedById: cancelledById,
            },
          }),
        );
      }

      await this.recordAppointmentGroupChange({
        actorUserId: cancelledById,
        action: 'appointment.cancel',
        groupId,
        beforeAppointments: currentMembers,
        afterAppointments: records,
        context: auditContext,
        writer: tx as unknown as Prisma.TransactionClient,
      });
      return records;
    });

    this.appointmentsEventsService.publishAppointmentsChanged(cancelledById);

    return {
      success: true,
      id,
      groupId,
      appointmentIds: cancelled.map((appointment) => appointment.id),
    };
  }

  async deleteAppointment(id: string, deletedById: string) {
    const existing = await this.getActiveAppointmentOrThrow(id);
    const groupId = existing.groupId ?? existing.id;
    const auditContext =
      await this.auditService.createAuditContext(deletedById);

    const deleted = await this.prismaService.$transaction(async (tx) => {
      const current = await tx.appointment.findFirst({
        where: { id, shopId: requireCurrentShopId(), deletedAt: null },
      });
      if (!current) throw new NotFoundException('Appointment not found');
      const currentMembers = await this.getActiveGroupMembers(
        current,
        tx as unknown as Prisma.TransactionClient,
      );
      const records: Appointment[] = [];

      for (const member of currentMembers) {
        records.push(
          await tx.appointment.update({
            where: { id: member.id },
            data: {
              status: AppointmentStatus.CANCELLED,
              deletedAt: new Date(),
              updatedById: deletedById,
            },
          }),
        );
      }

      await this.recordAppointmentGroupChange({
        actorUserId: deletedById,
        action: 'appointment.delete',
        groupId,
        beforeAppointments: currentMembers,
        afterAppointments: records,
        context: auditContext,
        writer: tx as unknown as Prisma.TransactionClient,
      });
      return records;
    });

    this.appointmentsEventsService.publishAppointmentsChanged(deletedById);

    return {
      success: true,
      id,
      groupId,
      appointmentIds: deleted.map((appointment) => appointment.id),
    };
  }

  moveAppointment(id: string, dto: MoveAppointmentDto) {
    return this.updateAppointment(
      id,
      {
        startAt: dto.startAt,
        endAt: dto.endAt,
        employeeId: dto.employeeId,
        updatedById: dto.updatedById,
        userRole: dto.userRole,
      },
      'appointment.move',
    );
  }

  private async getActiveGroupMembers(
    anchor: Appointment,
    client: PrismaClientOrTx = this
      .prismaService as unknown as PrismaClientOrTx,
  ) {
    if (!anchor.groupId) {
      return [anchor];
    }

    return client.appointment.findMany({
      where: {
        shopId: requireCurrentShopId(),
        groupId: anchor.groupId,
        deletedAt: null,
      },
    });
  }

  private async recordAppointmentGroupChange(change: {
    actorUserId: string;
    action: AppointmentAuditAction;
    groupId: string;
    beforePayload?: null;
    beforeAppointments?: Appointment[];
    afterAppointments: Appointment[];
    context: AuditContext;
    writer?: Pick<Prisma.TransactionClient, 'auditLog'>;
  }) {
    await this.auditService.recordAppointmentChange(
      {
        actorUserId: change.actorUserId,
        action: change.action,
        entityId: change.groupId,
        beforePayload:
          change.beforePayload === null
            ? null
            : this.toAuditGroupPayload(
                change.groupId,
                change.beforeAppointments ?? [],
              ),
        afterPayload: this.toAuditGroupPayload(
          change.groupId,
          change.afterAppointments,
        ),
      },
      change.context,
      change.writer,
    );
  }

  private async getActiveAppointmentOrThrow(id: string) {
    const appointment = await this.prismaService.appointment.findFirst({
      where: { id, shopId: requireCurrentShopId(), deletedAt: null },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    return appointment;
  }

  private assertNotCancelled(appointment: Appointment) {
    if (appointment.status === AppointmentStatus.CANCELLED) {
      throw new ConflictException('Cancelled appointments cannot be modified.');
    }
  }

  private async assertNoTimeConflict(
    employeeId: string,
    startAt: Date,
    endAt: Date,
    excludeId?: string,
    client: PrismaClientOrTx = this
      .prismaService as unknown as PrismaClientOrTx,
  ) {
    const conflict = await client.appointment.findFirst({
      where: {
        shopId: requireCurrentShopId(),
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

  private async isPendingAssignmentEmployee(
    employeeId: string,
    client: PrismaClientOrTx = this
      .prismaService as unknown as PrismaClientOrTx,
  ) {
    const pendingUsername = getPendingAssignmentEmployeeUsernameForShop(
      requireCurrentShopId(),
    );
    const user = await client.user.findFirst({
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
    const pendingUsername = getPendingAssignmentEmployeeUsernameForShop(
      requireCurrentShopId(),
    );
    const user = await this.prismaService.user.findFirst({
      where: { username: pendingUsername, deletedAt: null },
      select: { id: true },
    });

    return user?.id ?? null;
  }

  private normalizeGroupEmployeeIds(
    requestedEmployeeIds: string[],
    pendingEmployeeId: string | null,
  ) {
    const employeeIds = requestedEmployeeIds.filter(
      (employeeId) => employeeId !== pendingEmployeeId,
    );
    const uniqueEmployeeIds = new Set(employeeIds);

    if (uniqueEmployeeIds.size !== employeeIds.length) {
      throw new BadRequestException(
        'Duplicate employees are not allowed in a group appointment',
      );
    }

    return employeeIds;
  }

  private async getEmployeeSnapshot(
    employeeId: string,
    client: PrismaClientOrTx,
  ) {
    const shopId = requireCurrentShopId();
    const [user] = await client.$queryRaw<
      Array<{
        id: string;
        displayName: string | null;
        username: string;
        role: UserRole;
      }>
    >`
      SELECT id, display_name AS "displayName", username,
             CASE role::text WHEN 'manager' THEN 'MANAGER' ELSE 'EMPLOYEE' END AS role
      FROM users
      WHERE id = ${employeeId}
        AND status::text = 'active'
        AND deleted_at IS NULL
        AND (
          (
            role::text = 'employee'
            AND shop_id = ${shopId}
          )
          OR (
            role::text = 'manager'
          )
        )
      FOR SHARE
    `;
    if (!user) {
      throw new BadRequestException(
        'Selected service staff must be active and eligible for this shop.',
      );
    }

    return {
      employeeDisplayName: user.displayName ?? user.username,
      employeeColor: await this.staffColors.get(user, shopId, client),
    };
  }

  private validateTimeRange(startAt: Date, endAt: Date) {
    if (startAt >= endAt) {
      throw new BadRequestException('startAt must be earlier than endAt');
    }
  }

  private validateTimeNotInPast(startAt: Date, userRole?: string) {
    // Past booking creation is reserved for admins and managers.
    if (userRole === 'ADMIN' || userRole === 'MANAGER') {
      return;
    }

    const now = new Date();
    if (startAt < now) {
      throw new BadRequestException(
        'Cannot schedule appointment to a past time',
      );
    }
  }

  private toAuditPayload(appointment: Appointment) {
    return {
      id: appointment.id,
      employeeId: appointment.employeeId,
      employeeDisplayName: appointment.employeeDisplayName,
      employeeColor: appointment.employeeColor,
      groupId: appointment.groupId,
      startAt: appointment.startAt.toISOString(),
      endAt: appointment.endAt.toISOString(),
      phone: appointment.phone,
      price: this.formatCentsToUsd(appointment.price),
      customerName: appointment.customerName,
      serviceName: appointment.serviceName,
      status: appointment.status,
      note: appointment.note,
      createdById: appointment.createdById,
      updatedById: appointment.updatedById,
      createdAt: appointment.createdAt.toISOString(),
      updatedAt: appointment.updatedAt.toISOString(),
      deletedAt: appointment.deletedAt?.toISOString() ?? null,
    };
  }

  private toAuditGroupPayload(groupId: string, appointments: Appointment[]) {
    return {
      groupId,
      shopId: requireCurrentShopId(),
      appointmentIds: appointments.map((appointment) => appointment.id),
      partySize: appointments.filter((appointment) => !appointment.deletedAt)
        .length,
      appointments: appointments.map((appointment) =>
        this.toAuditPayload(appointment),
      ),
    };
  }

  private parseUsdToCents(value: string) {
    const cents = Number(value) * 100;
    if (
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(cents) ||
      cents > 2147483647
    ) {
      throw new BadRequestException(
        'price must be a non-negative whole USD amount within the supported range',
      );
    }

    return cents;
  }

  private formatCentsToUsd(value: number) {
    return value % 100 === 0 ? String(value / 100) : (value / 100).toFixed(2);
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

  private async runConflictCheckedAppointmentTransaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prismaService.$transaction(
        (tx) => work(tx as unknown as Prisma.TransactionClient),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'A concurrent appointment change occurred. Refresh and retry.',
        );
      }
      throw error;
    }
  }
}
