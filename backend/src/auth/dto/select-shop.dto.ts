import { IsString } from 'class-validator';

export class SelectShopDto {
  @IsString()
  shopId!: string;
}
