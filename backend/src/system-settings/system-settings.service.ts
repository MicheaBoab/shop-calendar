import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SHOP_SCOPED_PRISMA } from '../common/prisma/prisma.module';
import type { ShopScopedPrismaClient } from '../common/prisma/prisma.module';
import { requireCurrentShopId } from '../common/shop-context/shop-context';
import { UpdateCalendarWindowDto } from './dto/update-calendar-window.dto';
import { AuditService } from '../audit/audit.service';

const DEFAULT_SLOT_MIN_TIME = '10:00:00';
const DEFAULT_SLOT_MAX_TIME = '20:00:00';

@Injectable()
export class SystemSettingsService {
  constructor(
    @Inject(SHOP_SCOPED_PRISMA)
    private readonly prismaService: ShopScopedPrismaClient,
    private readonly auditService: AuditService,
  ) {}

  async getCalendarWindow() {
    const shopId = requireCurrentShopId();
    const settings = await this.prismaService.systemSetting.findUnique({
      where: { shopId },
      select: {
        calendarWindowStart: true,
        calendarWindowEnd: true,
      },
    });

    return {
      slotMinTime: settings?.calendarWindowStart ?? DEFAULT_SLOT_MIN_TIME,
      slotMaxTime: settings?.calendarWindowEnd ?? DEFAULT_SLOT_MAX_TIME,
    };
  }

  async updateCalendarWindow(
    dto: UpdateCalendarWindowDto,
    actorUserId: string,
  ) {
    this.assertWindowRange(dto.slotMinTime, dto.slotMaxTime);
    const shopId = requireCurrentShopId();
    const auditContext =
      await this.auditService.createAuditContext(actorUserId);

    const updated = await this.prismaService.$transaction(async (tx) => {
      const before = await tx.systemSetting.findUnique({
        where: { shopId },
        select: {
          calendarWindowStart: true,
          calendarWindowEnd: true,
        },
      });
      const after = await tx.systemSetting.upsert({
        where: { shopId },
        update: {
          calendarWindowStart: dto.slotMinTime,
          calendarWindowEnd: dto.slotMaxTime,
        },
        create: {
          shopId,
          calendarWindowStart: dto.slotMinTime,
          calendarWindowEnd: dto.slotMaxTime,
        },
        select: {
          calendarWindowStart: true,
          calendarWindowEnd: true,
        },
      });
      await this.auditService.recordSettingsChange(
        {
          actorUserId,
          entityId: shopId,
          beforePayload: {
            slotMinTime: before?.calendarWindowStart ?? DEFAULT_SLOT_MIN_TIME,
            slotMaxTime: before?.calendarWindowEnd ?? DEFAULT_SLOT_MAX_TIME,
          },
          afterPayload: {
            slotMinTime: after.calendarWindowStart ?? DEFAULT_SLOT_MIN_TIME,
            slotMaxTime: after.calendarWindowEnd ?? DEFAULT_SLOT_MAX_TIME,
          },
        },
        auditContext,
        tx as unknown as Prisma.TransactionClient,
      );
      return after;
    });

    return {
      slotMinTime: updated.calendarWindowStart ?? DEFAULT_SLOT_MIN_TIME,
      slotMaxTime: updated.calendarWindowEnd ?? DEFAULT_SLOT_MAX_TIME,
    };
  }

  private assertWindowRange(slotMinTime: string, slotMaxTime: string) {
    if (this.toMinutes(slotMinTime) >= this.toMinutes(slotMaxTime)) {
      throw new BadRequestException(
        'slotMinTime must be earlier than slotMaxTime',
      );
    }
  }

  private toMinutes(value: string) {
    const [hours, minutes] = value.split(':').map((part) => Number(part));
    return hours * 60 + minutes;
  }
}
