import { IsString, Matches, MaxLength } from 'class-validator';

export class ReassignUserColorDto {
  @IsString()
  @Matches(/^#[0-9a-f]{6}$/)
  currentColor!: string;

  @IsString()
  @Matches(/^#[0-9a-f]{6}$/)
  candidateColor!: string;

  @IsString()
  @MaxLength(12000)
  previewToken!: string;
}
