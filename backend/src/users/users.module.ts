import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { StaffColorsModule } from '../staff-colors/staff-colors.module';

@Module({
  imports: [AuditModule, StaffColorsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
