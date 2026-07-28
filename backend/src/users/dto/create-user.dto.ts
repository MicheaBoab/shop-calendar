import { Transform } from 'class-transformer';
import { UserRole } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @IsOptional()
  displayName?: string;

  @Transform(({ value }) => {
    if (typeof value !== 'string') {
      return value;
    }

    const normalized = value.trim().toUpperCase();
    if (normalized === 'ADMIN') {
      return UserRole.ADMIN;
    }
    if (normalized === 'EMPLOYEE') {
      return UserRole.EMPLOYEE;
    }

    return value;
  })
  @IsEnum(UserRole)
  role!: UserRole;
}