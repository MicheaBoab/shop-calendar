import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAppointmentDto } from './create-appointment.dto';

describe('CreateAppointmentDto', () => {
  it('accepts 10-15 digit phone and 2-decimal USD price', async () => {
    const dto = plainToInstance(CreateAppointmentDto, {
      employeeId: 'emp-1',
      startAt: '2026-07-28T15:00:00.000Z',
      endAt: '2026-07-28T16:00:00.000Z',
      phone: '3125551234',
      price: '45.00',
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });

  it('rejects invalid phone or non-2-decimal price', async () => {
    const dto = plainToInstance(CreateAppointmentDto, {
      employeeId: 'emp-1',
      startAt: '2026-07-28T15:00:00.000Z',
      endAt: '2026-07-28T16:00:00.000Z',
      phone: '31-2555',
      price: '45.5',
    });

    const errors = await validate(dto);

    const constraints = errors.flatMap((error) => Object.values(error.constraints ?? {}));
    expect(constraints.some((msg) => msg.includes('phone'))).toBe(true);
    expect(constraints.some((msg) => msg.includes('price'))).toBe(true);
  });

  it('rejects empty or whitespace employeeId', async () => {
    const emptyDto = plainToInstance(CreateAppointmentDto, {
      employeeId: '',
      startAt: '2026-07-28T15:00:00.000Z',
      endAt: '2026-07-28T16:00:00.000Z',
      phone: '3125551234',
      price: '45.00',
    });
    const whitespaceDto = plainToInstance(CreateAppointmentDto, {
      employeeId: '   ',
      startAt: '2026-07-28T15:00:00.000Z',
      endAt: '2026-07-28T16:00:00.000Z',
      phone: '3125551234',
      price: '45.00',
    });

    const emptyErrors = await validate(emptyDto);
    const whitespaceErrors = await validate(whitespaceDto);

    const emptyMessages = emptyErrors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );
    const whitespaceMessages = whitespaceErrors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );

    expect(
      emptyMessages.some((msg) => msg.includes('employeeId should not be empty')),
    ).toBe(true);
    expect(
      whitespaceMessages.some((msg) =>
        msg.includes('employeeId should not be empty'),
      ),
    ).toBe(true);
  });
});
