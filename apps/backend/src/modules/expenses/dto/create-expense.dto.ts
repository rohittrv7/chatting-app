import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsArray,
  IsOptional,
  IsIn,
  IsObject,
  Min,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateExpenseSplitDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  totalAmount!: number;

  @IsString()
  @IsOptional()
  currency?: string = 'INR';

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  participantUserIds?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  participantIds?: string[];

  @IsString()
  @IsOptional()
  paidByUserId?: string;

  @IsString()
  @IsOptional()
  @IsIn(['EQUAL', 'CUSTOM', 'EXACT', 'PERCENT', 'SHARES'])
  splitType?: 'EQUAL' | 'CUSTOM' | 'EXACT' | 'PERCENT' | 'SHARES' = 'EQUAL';

  @IsObject()
  @IsOptional()
  customAmounts?: Record<string, number>;

  @IsObject()
  @IsOptional()
  shares?: Record<string, number>;

  @IsString()
  @IsOptional()
  category?: string = 'OTHER';

  @IsBoolean()
  @IsOptional()
  isOngoingGroup?: boolean;

  @IsString()
  @IsOptional()
  conversationId?: string;

  @IsBoolean()
  @IsOptional()
  autoCreateGroup?: boolean;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  debugDeleteInSeconds?: number;
}

export class SettleUpDto {
  @IsString()
  @IsNotEmpty()
  targetUserId!: string;

  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount!: number;

  @IsString()
  @IsOptional()
  currency?: string = 'INR';

  @IsString()
  @IsOptional()
  notes?: string;
}
