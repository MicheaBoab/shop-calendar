import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { UpdateCalendarWindowDto } from './dto/update-calendar-window.dto';

const DEFAULT_SLOT_MIN_TIME = '10:00:00';
const DEFAULT_SLOT_MAX_TIME = '23:00:00';
const SYSTEM_SETTINGS_ID = 1;

@Injectable()
export class SystemSettingsService {
  constructor(private readonly prismaService: PrismaService) {}

  async getCalendarWindow() {
    const settings = await this.prismaService.systemSetting.findUnique({
      where: { id: SYSTEM_SETTINGS_ID },
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

    const updated = await this.prismaService.systemSetting.upsert({
      where: { id: SYSTEM_SETTINGS_ID },
      update: {
        calendarWindowStart: dto.slotMinTime,
        calendarWindowEnd: dto.slotMaxTime,
      },
      create: {
        id: SYSTEM_SETTINGS_ID,
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
