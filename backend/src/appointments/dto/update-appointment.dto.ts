import { AppointmentStatus } from '@prisma/client';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class UpdateAppointmentDto {
  @IsString()
  @IsOptional()
  updatedById?: string;

  @IsString()
  @IsOptional()
  @Matches(/\S/, { message: 'employeeId should not be empty' })
  employeeId?: string;

  @IsISO8601()
  @IsOptional()
  startAt?: string;

  @IsISO8601()
  @IsOptional()
  endAt?: string;

  @IsString()
  @Matches(/^\d{10,15}$/)
  @IsOptional()
  phone?: string;

  @IsString()
  @Matches(/^\d+(\.\d{2})$/)
  @IsOptional()
  price?: string;

  @IsString()
  @IsOptional()
  customerName?: string;

  @IsString()
  @IsOptional()
  serviceName?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsEnum(AppointmentStatus)
  @IsOptional()
  status?: AppointmentStatus;
}