import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class MoveAppointmentDto {
  @IsISO8601()
  startAt!: string;

  @IsISO8601()
  endAt!: string;

  @IsString()
  @IsOptional()
  updatedById?: string;

  @IsString()
  @IsOptional()
  employeeId?: string;
}