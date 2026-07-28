import {
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreateAppointmentDto {
  @IsString()
  @Matches(/\S/, { message: 'employeeId should not be empty' })
  employeeId!: string;

  @IsISO8601()
  startAt!: string;

  @IsISO8601()
  endAt!: string;

  @IsString()
  @Matches(/^\d{10,15}$/)
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
}