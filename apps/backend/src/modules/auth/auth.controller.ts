import { Controller, Post, Get, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RequestOtpDto, VerifyOtpDto, RefreshTokenDto } from '@chat/shared-contracts';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/user.decorator';

@ApiTags('Auth & Device Management')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('otp/request')
  @Public()
  @ApiOperation({ summary: 'Request phone verification OTP' })
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto);
  }

  @Post('otp/verify')
  @Public()
  @ApiOperation({ summary: 'Verify OTP and authenticate device' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Post('token/refresh')
  @Public()
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
  async revokeDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('deviceId') deviceId: string,
  ) {
    return this.authService.revokeDevice(user.userId, deviceId);
  }
}
