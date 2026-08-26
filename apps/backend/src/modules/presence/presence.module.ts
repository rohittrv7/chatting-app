import { Module } from '@nestjs/common';

/**
 * PresenceModule is kept as a stub for future standalone presence features.
 * All presence logic (online/offline/typing) is handled by ChatGateway in MessageModule.
 */
@Module({})
export class PresenceModule {}
