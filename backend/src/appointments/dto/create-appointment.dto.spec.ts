import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAppointmentDto } from './create-appointment.dto';
import { UpdateAppointmentDto } from './update-appointment.dto';

describe('CreateAppointmentDto', () => {
  it('accepts 10-digit phone and whole USD price with a 45-minute duration', async () => {
    const dto = plainToInstance(CreateAppointmentDto, {
      employeeId: 'emp-1',
      startAt: '2026-07-28T15:00:00.000Z',
      endAt: '2026-07-28T15:45:00.000Z',
      phone: '3125551234',
      price: '45',
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });

  it('rejects invalid phone or fractional price', async () => {
    const dto = plainToInstance(CreateAppointmentDto, {
      employeeId: 'emp-1',
      startAt: '2026-07-28T15:00:00.000Z',
      endAt: '2026-07-28T16:00:00.000Z',
      phone: '31-2555',
      price: '45.5',
    });

    const errors = await validate(dto);

    const constraints = errors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );
    expect(constraints.some((msg) => msg.includes('phone'))).toBe(true);
    expect(constraints.some((msg) => msg.includes('price'))).toBe(true);
  });

  it('rejects phone longer than 10 digits', async () => {
    const dto = plainToInstance(CreateAppointmentDto, {
      employeeId: 'emp-1',
      startAt: '2026-07-28T15:00:00.000Z',
      endAt: '2026-07-28T16:00:00.000Z',
      phone: '31255512345',
      price: '45',
    });

    const errors = await validate(dto);
    const constraints = errors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );
    expect(constraints.some((msg) => msg.includes('phone'))).toBe(true);
  });

  it('rejects empty or whitespace employeeId', async () => {
    const emptyDto = plainToInstance(CreateAppointmentDto, {
      employeeId: '',
      startAt: '2026-07-28T15:00:00.000Z',
      endAt: '2026-07-28T16:00:00.000Z',
      phone: '3125551234',
      price: '45',
    });
    const whitespaceDto = plainToInstance(CreateAppointmentDto, {
      employeeId: '   ',
      startAt: '2026-07-28T15:00:00.000Z',
      endAt: '2026-07-28T16:00:00.000Z',
      phone: '3125551234',
      price: '45',
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
      emptyMessages.some((msg) =>
        msg.includes('employeeId should not be empty'),
      ),
    ).toBe(true);
    expect(
      whitespaceMessages.some((msg) =>
        msg.includes('employeeId should not be empty'),
      ),
    ).toBe(true);
  });

  it.each(['70.00', '70.50', '70.5', '-1', '1e2'])('rejects price %s on create and update', async (price) => {
    const createErrors = await validate(plainToInstance(CreateAppointmentDto, {
      startAt: '2026-07-28T15:00:00.000Z',
      endAt: '2026-07-28T15:45:00.000Z',
      phone: '3125551234',
      price,
    }));
    const updateErrors = await validate(plainToInstance(UpdateAppointmentDto, { price }));
    expect(createErrors.some((error) => error.property === 'price')).toBe(true);
    expect(updateErrors.some((error) => error.property === 'price')).toBe(true);
  });

  it('allows an integer update and an update that omits historical price', async () => {
    expect(await validate(plainToInstance(UpdateAppointmentDto, { price: '70' }))).toEqual([]);
    expect(await validate(plainToInstance(UpdateAppointmentDto, { note: 'Changed note' }))).toEqual([]);
  });
});
