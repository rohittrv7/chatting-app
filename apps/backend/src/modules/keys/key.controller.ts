import { Controller, Post, Get, Body, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { KeyService } from './key.service';
import { RegisterKeysDto } from '@chat/shared-contracts';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/user.decorator';

@ApiTags('Signal Key Directory')
@Controller('keys')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class KeyController {
  constructor(private readonly keyService: KeyService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register device Signal Identity Key, Signed PreKey, and One-Time PreKeys' })
  async registerKeys(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterKeysDto,
  ) {
    return this.keyService.registerKeys(user.userId, user.deviceId, dto);
  }

  @Get('bundle/:targetUserId/:targetDeviceId')
  @ApiOperation({ summary: 'Fetch X3DH PreKey bundle for target user device' })
  async getPreKeyBundle(
    @Param('targetUserId') targetUserId: string,
    @Param('targetDeviceId', ParseIntPipe) targetDeviceId: number,
  ) {
    return this.keyService.getPreKeyBundle(targetUserId, targetDeviceId);
  }

  @Get('devices/:targetUserId')
  @ApiOperation({ summary: 'Fetch list of active devices for target user' })
  async getDevicesForUser(@Param('targetUserId') targetUserId: string) {
    return this.keyService.getDevicesForUser(targetUserId);
  }
}
