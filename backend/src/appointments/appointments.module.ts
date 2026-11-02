import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AuditModule } from '../audit/audit.module';
import { AppointmentsEventsService } from './appointments-events.service';
import { StaffColorsModule } from '../staff-colors/staff-colors.module';
import { AppointmentsAuthGuard } from './appointments-auth.guard';

@Module({
  imports: [AuditModule, JwtModule, StaffColorsModule],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsService,
    AppointmentsEventsService,
    AppointmentsAuthGuard,
  ],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
