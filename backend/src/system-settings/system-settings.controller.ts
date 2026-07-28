import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateCalendarWindowDto } from './dto/update-calendar-window.dto';
import { SystemSettingsService } from './system-settings.service';

@Controller('system-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SystemSettingsController {
  constructor(private readonly systemSettingsService: SystemSettingsService) {}

  @Get('calendar-window')
  getCalendarWindow() {
    return this.systemSettingsService.getCalendarWindow();
  }

  @Patch('calendar-window')
  @Roles(UserRole.ADMIN)
  updateCalendarWindow(@Body() dto: UpdateCalendarWindowDto) {
    return this.systemSettingsService.updateCalendarWindow(dto);
  }
}
