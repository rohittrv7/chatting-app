import { IsString, IsNotEmpty, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class OneTimePreKeyDto {
  @IsNumber()
  keyId!: number;

  @IsString()
  @IsNotEmpty()
  publicKey!: string;
}

export class RegisterKeysDto {
  @IsNumber()
  deviceId!: number;

  @IsString()
  @IsNotEmpty()
  identityPublicKey!: string;

  @IsNumber()
  signedPreKeyId!: number;

  @IsString()
  @IsNotEmpty()
  signedPrePublicKey!: string;

  @IsString()
  @IsNotEmpty()
  signedPreKeySignature!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OneTimePreKeyDto)
  oneTimePreKeys!: OneTimePreKeyDto[];
}

export class PreKeyBundleDto {
  userId!: string;
  deviceId!: number;
  registrationId!: number;
  identityPublicKey!: string;
  signedPreKeyId!: number;
  signedPrePublicKey!: string;
  signedPreKeySignature!: string;
  oneTimePreKeyId?: number;
  oneTimePrePublicKey?: string;
}
