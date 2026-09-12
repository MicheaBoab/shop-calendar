import { Transform } from 'class-transformer';
import type { TransformFnParams } from 'class-transformer';
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

  @Transform(({ value }: TransformFnParams) => {
    if (typeof value !== 'string') {
      return value as unknown;
    }

    const normalized = value.trim().toUpperCase();
    if (normalized === 'ADMIN') {
      return UserRole.ADMIN;
    }
    if (normalized === 'EMPLOYEE') {
      return UserRole.EMPLOYEE;
    }
    if (normalized === 'MULTI_SHOP_EMPLOYEE') {
      return UserRole.MULTI_SHOP_EMPLOYEE;
    }

    return value as unknown;
  })
  @IsEnum(UserRole)
  role!: UserRole;
}
