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
});
