import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MediaService } from './media.service';
import { MessageCleanupService } from '../messages/message-cleanup.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/user.decorator';
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, Max, IsIn } from 'class-validator';
import { MAX_MEDIA_FILE_SIZE_BYTES } from '@chat/shared-contracts';

export class RequestUploadUrlDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  /** File size in bytes (Max 10 MB = 10,485,760 bytes) */
  @IsNumber()
  @Min(1, { message: 'File size must be at least 1 byte' })
  @Max(MAX_MEDIA_FILE_SIZE_BYTES, {
    message: 'File size exceeds maximum allowed limit of 10 MB',
  })
  fileSize!: number;

  /** Lossless storage compression encoding */
  @IsString()
  @IsOptional()
  @IsIn(['gzip', 'deflate', 'identity', 'none'])
  contentEncoding?: string;

  /** Original uncompressed file size for quality preservation tracking */
  @IsNumber()
  @IsOptional()
  @Min(1)
  originalSize?: number;

  /** Image / video resolution width in pixels */
  @IsNumber()
  @IsOptional()
  width?: number;

  /** Image / video resolution height in pixels */
  @IsNumber()
  @IsOptional()
  height?: number;

  /** Audio / video duration in seconds */
  @IsNumber()
  @IsOptional()
  durationSeconds?: number;
}

@ApiTags('Media')
@Controller('media')
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly messageCleanupService: MessageCleanupService,
  ) {}

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Direct media upload for chat photos & attachments (requires auth)' })
  async uploadDirect(@Body() dto: { base64Data: string; fileName?: string; mimeType?: string }) {
    return this.mediaService.uploadDirectFile(dto);
  }

  @Post('upload-url')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Request presigned Backblaze B2 URL for uploading client-side encrypted media blob (Max 10MB)',
  })
  async getUploadUrl(@Body() dto: RequestUploadUrlDto) {
    return this.mediaService.getPresignedUploadUrl(dto);
  }

  @Get('download-url/:objectKey(*)')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Request presigned Backblaze B2 URL for downloading encrypted media blob',
  })
  async getDownloadUrl(@Param('objectKey') objectKey: string) {
    return this.mediaService.getPresignedDownloadUrl(objectKey);
  }

  /**
   * Record that the calling user has successfully downloaded an attachment.
   * Called by the mobile app immediately after a successful media download.
   * Used by the relay-only cleanup cron to know when all recipients have
   * received a file — after that the server copy can be safely deleted.
   */
  @Post('attachment/:attachmentId/downloaded')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Record that the authenticated user has downloaded an attachment' })
  async recordDownload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attachmentId') attachmentId: string,
  ) {
    await this.messageCleanupService.recordAttachmentDownload(attachmentId, user.userId);
    return { success: true };
  }
}
