import {
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  DEFAULT_PENDING_EMPLOYEE_COLOR,
  getPendingAssignmentEmployeeUsername,
  isPendingAssignmentEmployeeUsername,
} from '../common/pending-assignment';
import { chooseColor } from './color-palette';

type StaffIdentity = { id: string; username: string; role: UserRole };

@Injectable()
export class StaffColorsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // One-time missing-map initialization, never a GET-time reset.
    await this.initializeMissing();
  }

  async lock(tx: Prisma.TransactionClient, shopId?: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(714021, 0)::text`;
    if (shopId)
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(714022, hashtext(${shopId}))::text`;
  }

  async initializeMissing() {
    await this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx);
        const staff = await tx.user.findMany({
          where: {
            deletedAt: null,
            role: { in: [UserRole.MANAGER, UserRole.EMPLOYEE] },
          },
          select: { id: true, shopId: true, username: true, role: true },
          orderBy: [{ role: 'desc' }, { id: 'asc' }],
        });
        // Explicit manager-first ordering independent of enum ordering.
        for (const user of staff.filter((u) => u.role === UserRole.MANAGER)) {
          await this.allocate(tx, user, user.shopId);
        }
        for (const user of staff.filter((u) => u.role === UserRole.EMPLOYEE)) {
          await this.lock(tx, user.shopId);
          await this.allocate(tx, user, user.shopId);
        }
      },
      { timeout: 120_000 },
    );
  }

  // Caller must acquire global -> shop locks BEFORE writing user rows.
  async allocate(
    tx: Prisma.TransactionClient,
    user: StaffIdentity,
    shopId: string,
  ) {
    if (user.role !== UserRole.EMPLOYEE && user.role !== UserRole.MANAGER)
      return undefined;
    if (isPendingAssignmentEmployeeUsername(user.username))
      return DEFAULT_PENDING_EMPLOYEE_COLOR;
    const existing = await this.find(tx, user, shopId);
    if (existing) return existing;
    // Raw queries deliberately cross tenant boundaries, returning colors only.
    const managers = await tx.$queryRaw<
      Array<{ color: string }>
    >`SELECT color FROM manager_color_map`;
    const employees =
      user.role === UserRole.MANAGER
        ? await tx.$queryRaw<Array<{ color: string }>>`
          SELECT m.color FROM staff_color_map m JOIN users u ON u.id = m.user_id
          WHERE u.role::text = 'employee'
            AND u.status::text IN ('active', 'inactive') AND u.deleted_at IS NULL
            AND u.username <> ${getPendingAssignmentEmployeeUsername()}
            AND NOT starts_with(u.username, ${`${getPendingAssignmentEmployeeUsername()}__`})`
        : await tx.$queryRaw<
            Array<{ color: string }>
          >`SELECT color FROM staff_color_map WHERE shop_id = ${shopId}`;
    const color = chooseColor(
      [...managers, ...employees].map((row) => row.color),
      DEFAULT_PENDING_EMPLOYEE_COLOR,
    );
    if (user.role === UserRole.MANAGER) {
      await tx.managerColorMap.create({ data: { userId: user.id, color } });
    } else {
      await tx.staffColorMap.create({
        data: { shopId, userId: user.id, color },
      });
    }
    return color;
  }

  async get(
    user: StaffIdentity,
    shopId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    if (user.role !== UserRole.EMPLOYEE && user.role !== UserRole.MANAGER)
      return undefined;
    if (isPendingAssignmentEmployeeUsername(user.username))
      return DEFAULT_PENDING_EMPLOYEE_COLOR;
    const color = await this.find(tx, user, shopId);
    if (!color || !/^#[0-9a-f]{6}$/i.test(color)) {
      throw new ServiceUnavailableException(
        'Service staff color is missing or invalid; initialize persisted colors.',
      );
    }
    return color;
  }

  // Same allocator/reservations as a new local employee. Include the target's
  // old color, so reassignment never proposes that same color again.
  async previewReassignment(tx: Prisma.TransactionClient, shopId: string) {
    const managers = await tx.$queryRaw<Array<{ color: string }>>`
      SELECT color FROM manager_color_map`;
    const employees = await tx.$queryRaw<Array<{ color: string }>>`
      SELECT color FROM staff_color_map WHERE shop_id = ${shopId}`;
    return chooseColor(
      [...managers, ...employees].map((row) => row.color),
      DEFAULT_PENDING_EMPLOYEE_COLOR,
    );
  }

  async saveReassignment(
    tx: Prisma.TransactionClient,
    shopId: string,
    userId: string,
    color: string,
  ) {
    await tx.staffColorMap.update({
      where: { shopId_userId: { shopId, userId } },
      data: { color },
    });
    // Keep every appointment snapshot for this employee in sync, including
    // cancelled and soft-deleted history. A raw update intentionally avoids
    // Prisma's @updatedAt behavior and leaves every other field untouched.
    // Pending assignments have their own user ID and are therefore excluded.
    await tx.$executeRaw`
      UPDATE appointments
      SET employee_color = ${color}
      WHERE shop_id = ${shopId} AND employee_id = ${userId}`;
  }

  private async find(
    tx: Prisma.TransactionClient,
    user: StaffIdentity,
    shopId: string,
  ) {
    if (user.role === UserRole.MANAGER) {
      return (
        await tx.managerColorMap.findUnique({
          where: { userId: user.id },
          select: { color: true },
        })
      )?.color;
    }
    return (
      await tx.staffColorMap.findUnique({
        where: { shopId_userId: { shopId, userId: user.id } },
        select: { color: true },
      })
    )?.color;
  }
}
