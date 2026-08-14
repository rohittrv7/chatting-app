import { IsString, IsNotEmpty, IsEnum, IsObject } from 'class-validator';
import { CallType } from '../enums/domain.enums';

export class CallOfferDto {
  @IsString()
  @IsNotEmpty()
  callId!: string;

  @IsString()
  @IsNotEmpty()
  targetUserId!: string;

  @IsEnum(CallType)
  type!: CallType;

  @IsObject()
  @IsNotEmpty()
  sdpOffer!: Record<string, unknown>;
}

export class CallAnswerDto {
  @IsString()
  @IsNotEmpty()
  callId!: string;

  @IsString()
  @IsNotEmpty()
  callerUserId!: string;

  @IsObject()
  @IsNotEmpty()
  sdpAnswer!: Record<string, unknown>;
}

export class IceCandidateDto {
  @IsString()
  @IsNotEmpty()
  callId!: string;

  @IsString()
  @IsNotEmpty()
  targetUserId!: string;

  @IsObject()
  @IsNotEmpty()
  candidate!: Record<string, unknown>;
}

export class CallRejectDto {
  @IsString()
  @IsNotEmpty()
  callId!: string;

  @IsString()
  @IsNotEmpty()
  callerUserId!: string;
}

export class CallEndDto {
  @IsString()
  @IsNotEmpty()
  callId!: string;

  @IsString()
  @IsNotEmpty()
  targetUserId!: string;
}
