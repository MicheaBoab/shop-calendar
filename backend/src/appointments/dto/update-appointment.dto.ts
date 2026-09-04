import { AppointmentStatus, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class UpdateAppointmentDto {
  @IsString()
  @IsOptional()
  updatedById?: string;

  @IsString()
  @IsOptional()
  @Matches(/\S/, { message: 'employeeId should not be empty' })
  employeeId?: string;

  // Group edit: replaces the full set of real employees linked to this appointment's group.
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  employeeIds?: string[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  @IsOptional()
  partySize?: number;

  @IsISO8601()
  @IsOptional()
  startAt?: string;

  @IsISO8601()
  @IsOptional()
  endAt?: string;

  @IsString()
  @Matches(/^\d{10}$/)
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

  userRole?: UserRole;
}