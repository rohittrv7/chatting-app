import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MediaService } from './media.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
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
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload-url')
  @ApiOperation({
    summary:
      'Request presigned Backblaze B2 URL for uploading client-side encrypted media blob (Max 10MB)',
  })
  async getUploadUrl(@Body() dto: RequestUploadUrlDto) {
    return this.mediaService.getPresignedUploadUrl(dto);
  }

  @Get('download-url/:objectKey(*)')
  @ApiOperation({
    summary: 'Request presigned Backblaze B2 URL for downloading encrypted media blob',
  })
  async getDownloadUrl(@Param('objectKey') objectKey: string) {
    return this.mediaService.getPresignedDownloadUrl(objectKey);
  }
}
