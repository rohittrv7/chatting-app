import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsNumberString,
  Length,
  MinLength,
  MaxLength,
  IsEnum,
} from 'class-validator';
import { Platform } from '../enums/domain.enums';

export class RequestOtpDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;
}

export class VerifyOtpDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;

  /** Must be exactly 6 numeric digits */
  @IsNumberString()
  @Length(6, 6)
  otp!: string;

  @IsNumber()
  deviceId!: number;

  /** Device name between 1 and 50 characters */
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  deviceName!: string;

  @IsEnum(Platform)
  platform!: Platform;

  @IsString()
  @IsOptional()
  fcmToken?: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;

  @IsString()
  @IsNotEmpty()
  deviceId!: string;
}

export class SyncContactsDto {
  @IsNotEmpty()
  phoneNumbers!: string[];
}

export interface RegisteredContactUserDto {
  id: string;
  phoneNumber: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  about: string | null;
  isRegistered: boolean;
}

export interface SyncContactsResponseDto {
  registered: RegisteredContactUserDto[];
  unregistered: string[];
}
