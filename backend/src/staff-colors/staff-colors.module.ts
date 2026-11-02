import { Module } from '@nestjs/common';
import { StaffColorsService } from './staff-colors.service';

@Module({ providers: [StaffColorsService], exports: [StaffColorsService] })
export class StaffColorsModule {}
