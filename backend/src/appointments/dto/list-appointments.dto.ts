import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class ListAppointmentsDto {
  @IsString()
  @IsOptional()
  employeeId?: string;

  @IsString()
  @IsOptional()
  groupId?: string;

  @IsISO8601()
  @IsOptional()
  rangeStart?: string;

  @IsISO8601()
  @IsOptional()
  rangeEnd?: string;
}