import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole } from '@prisma/client';
import { CreateUserDto } from './create-user.dto';

describe('CreateUserDto', () => {
  it('accepts lowercase role values from the UI', async () => {
    const dto = plainToInstance(CreateUserDto, {
      username: 'jane',
      password: 'secret123',
      displayName: 'Jane Doe',
      role: 'employee',
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
    expect(dto.role).toBe(UserRole.EMPLOYEE);
  });

  it('accepts manager role values from the UI', async () => {
    const dto = plainToInstance(CreateUserDto, {
      username: 'manager',
      password: 'secret123',
      displayName: 'Manager',
      role: 'manager',
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
    expect(dto.role).toBe(UserRole.MANAGER);
  });

  it('accepts the shared shop account role', async () => {
    const dto = plainToInstance(CreateUserDto, {
      username: 'shop',
      password: 'secret123',
      role: 'shop_account',
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.role).toBe(UserRole.SHOP_ACCOUNT);
  });
});
