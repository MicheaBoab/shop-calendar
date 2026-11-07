import { IsString, Matches } from 'class-validator';

export class ReassignUserColorDto {
  @IsString()
  @Matches(/^#[0-9a-f]{6}$/)
  currentColor!: string;

  @IsString()
  @Matches(/^#[0-9a-f]{6}$/)
  candidateColor!: string;
}
