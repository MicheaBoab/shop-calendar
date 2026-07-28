import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCalendarWindowDto } from './update-calendar-window.dto';

describe('UpdateCalendarWindowDto', () => {
  it('accepts half-hour HH:mm:ss values with seconds at 00', async () => {
    const dto = plainToInstance(UpdateCalendarWindowDto, {
      slotMinTime: '10:00:00',
      slotMaxTime: '23:00:00',
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });

  it('rejects invalid format, non-half-hour minutes, or seconds not equal to 00', async () => {
    const dto = plainToInstance(UpdateCalendarWindowDto, {
      slotMinTime: '10:15:00',
      slotMaxTime: '23:00:30',
    });

    const errors = await validate(dto);
    const constraints = errors.flatMap((error) => Object.values(error.constraints ?? {}));

    expect(constraints.length).toBeGreaterThan(0);
  });
});
