import { Controller, Post, Get, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RequestOtpDto, VerifyOtpDto, RefreshTokenDto } from '@chat/shared-contracts';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/user.decorator';
import {
  IsString,
  IsOptional,
  MaxLength,
  Matches,
  IsUrl,
  IsArray,
  IsNotEmpty,
} from 'class-validator';

// ─── Validated DTOs ───────────────────────────────────────────────────────────

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  // Usernames: alphanumeric + underscore only — prevents injection via username field
  @Matches(/^[a-zA-Z0-9_]*$/, {
    message: 'Username can only contain letters, numbers, and underscores',
  })
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  // Prevent local file:// / data: / blob: URIs from being stored as avatar
  avatarUrl?: string;
}

export class UploadAvatarDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5_000_000) // ~3.75 MB base64 = ~2.8 MB raw (enforce server-side too)
  base64Data!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;
}

export class SyncContactsDto {
  @IsArray()
  phoneNumbers!: string[];
}

export class BlockUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(36)
  targetUserId!: string;
}

@ApiTags('Auth & Device Management')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('otp/request')
  @Public()
  // FIX: Rate limit — 5 requests per 10 minutes per IP (brute force protection)
  @Throttle({ otp: { limit: 5, ttl: 10 * 60 * 1000 } })
  @ApiOperation({ summary: 'Request phone verification OTP' })
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto);
  }

  @Post('otp/verify')
  @Public()
  // FIX: Rate limit — 10 attempts per 10 minutes per IP (per-phone lockout handled in Redis too)
  @Throttle({ otp: { limit: 10, ttl: 10 * 60 * 1000 } })
  @ApiOperation({ summary: 'Verify OTP and authenticate device' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Post('token/refresh')
  @Public()
  // FIX: Rate limit — 20 refreshes per 10 minutes per IP to prevent token churning
  @Throttle({ otp: { limit: 20, ttl: 10 * 60 * 1000 } })
  @ApiOperation({ summary: 'Rotate refresh token and issue new access token' })
  async refreshToken(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto);
  }

  @Get('devices')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List active devices logged into account' })
  async listDevices(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.listDevices(user.userId);
  }

  @Delete('devices/:deviceId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remote logout target device' })
  async revokeDevice(@CurrentUser() user: AuthenticatedUser, @Param('deviceId') deviceId: string) {
    return this.authService.revokeDevice(user.userId, deviceId);
  }

  @Post('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user profile (Name, Username, Bio, Avatar)' })
  async updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.userId, dto);
  }

  @Post('avatar')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload and set user avatar profile picture' })
  async uploadAvatar(@CurrentUser() user: AuthenticatedUser, @Body() dto: UploadAvatarDto) {
    return this.authService.uploadAvatar(user.userId, dto);
  }

  @Post('fcm-token')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update FCM push notification device token for this device' })
  async updateFcmToken(@CurrentUser() user: AuthenticatedUser, @Body() dto: { fcmToken: string }) {
    if (!dto?.fcmToken || typeof dto.fcmToken !== 'string' || dto.fcmToken.length < 10) {
      return { success: false, message: 'Valid fcmToken is required' };
    }
    return this.authService.updateFcmToken(user.userId, user.deviceId, dto.fcmToken);
  }

  @Post('contacts/sync')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sync phone contacts and discover registered users' })
  async syncContacts(@CurrentUser() user: AuthenticatedUser, @Body() dto: SyncContactsDto) {
    return this.authService.syncContacts(user.userId, dto.phoneNumbers || []);
  }

  @Get('users/search')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search registered users across the platform by username or name' })
  async searchUsers(@CurrentUser() user: AuthenticatedUser, @Query('q') query: string) {
    // FIX: Sanitize query — strip HTML/script tags and limit length
    const safeQuery = (query || '')
      .replace(/<[^>]*>/g, '')
      .trim()
      .slice(0, 100);
    return this.authService.searchUsers(user.userId, safeQuery);
  }

  @Post('users/block')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Block target user from contacting or viewing profile' })
  async blockUser(@CurrentUser() user: AuthenticatedUser, @Body() dto: BlockUserDto) {
    return this.authService.blockUser(user.userId, dto.targetUserId);
  }

  @Post('users/unblock')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unblock target user' })
  async unblockUser(@CurrentUser() user: AuthenticatedUser, @Body() dto: BlockUserDto) {
    return this.authService.unblockUser(user.userId, dto.targetUserId);
  }

  @Get('users/blocked')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get list of users blocked by current user' })
  async getBlockedUsers(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getBlockedUsers(user.userId);
  }

  @Get('users/block-status/:targetUserId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get bidirectional block status with target user' })
  async getBlockStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('targetUserId') targetUserId: string,
  ) {
    return this.authService.getBlockStatus(user.userId, targetUserId);
  }

  @Post('account/deactivate')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Deactivate (soft-delete) own account — sets isActive=false, disconnects all sessions',
  })
  async deactivateAccount(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.deactivateAccount(user.userId);
  }

  @Get('settings')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user privacy & notification settings' })
  async getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getSettings(user.userId);
  }

  @Post('settings')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user privacy & notification settings' })
  async updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    dto: {
      readReceipts?: boolean;
      lastSeenVisibility?: string;
      profilePhotoVis?: string;
      about?: string;
      theme?: string;
      messageNotifications?: boolean;
      callNotifications?: boolean;
      notificationPreview?: boolean;
    },
  ) {
    return this.authService.updateSettings(user.userId, dto);
  }
}
