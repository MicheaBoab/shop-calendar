import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class PreviewUserColorDto {
  @IsOptional()
  @IsString()
  @MaxLength(6000)
  @Matches(/^#[0-9a-f]{6}(,#[0-9a-f]{6})*$/)
  excluded?: string;
}
