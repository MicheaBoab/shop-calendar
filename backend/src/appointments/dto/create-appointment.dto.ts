import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateAppointmentDto {
  @IsString()
  @IsOptional()
  @Matches(/\S/, { message: 'employeeId should not be empty' })
  employeeId?: string;

  // Multi-employee group booking: when set, takes precedence over employeeId.
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  employeeIds?: string[];

  // Total headcount for a group booking; unassigned slots fall back to "pending".
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  @IsOptional()
  partySize?: number;

  @IsISO8601()
  startAt!: string;

  @IsISO8601()
  endAt!: string;

  @IsString()
  @Matches(/^\d{10}$/)
  phone!: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d+(\.\d{2})$/)
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

  @IsString()
  @IsOptional()
  createdById?: string;

  userRole?: UserRole;
}