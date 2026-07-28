import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AuditModule } from '../audit/audit.module';
import { AppointmentsEventsService } from './appointments-events.service';

@Module({
  imports: [AuditModule, JwtModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, AppointmentsEventsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
