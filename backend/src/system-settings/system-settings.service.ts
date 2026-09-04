import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SHOP_SCOPED_PRISMA } from '../common/prisma/prisma.module';
import type { ShopScopedPrismaClient } from '../common/prisma/prisma.module';
import { requireCurrentShopId } from '../common/shop-context/shop-context';
import { UpdateCalendarWindowDto } from './dto/update-calendar-window.dto';

const DEFAULT_SLOT_MIN_TIME = '10:00:00';
const DEFAULT_SLOT_MAX_TIME = '23:00:00';

@Injectable()
export class SystemSettingsService {
  constructor(@Inject(SHOP_SCOPED_PRISMA) private readonly prismaService: ShopScopedPrismaClient) {}

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

  async updateCalendarWindow(dto: UpdateCalendarWindowDto) {
    this.assertWindowRange(dto.slotMinTime, dto.slotMaxTime);
    const shopId = requireCurrentShopId();

    const updated = await this.prismaService.systemSetting.upsert({
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

    return {
      slotMinTime: updated.calendarWindowStart ?? DEFAULT_SLOT_MIN_TIME,
      slotMaxTime: updated.calendarWindowEnd ?? DEFAULT_SLOT_MAX_TIME,
    };
  }

  private assertWindowRange(slotMinTime: string, slotMaxTime: string) {
    if (this.toMinutes(slotMinTime) >= this.toMinutes(slotMaxTime)) {
      throw new BadRequestException('slotMinTime must be earlier than slotMaxTime');
    }
  }

  private toMinutes(value: string) {
    const [hours, minutes] = value.split(':').map((part) => Number(part));
    return hours * 60 + minutes;
  }
}
