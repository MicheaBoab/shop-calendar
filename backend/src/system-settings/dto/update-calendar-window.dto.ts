import { Matches } from 'class-validator';

export class UpdateCalendarWindowDto {
  @Matches(/^([01]\d|2[0-3]):(00|30):00$/)
  slotMinTime!: string;

  @Matches(/^([01]\d|2[0-3]):(00|30):00$/)
  slotMaxTime!: string;
}
