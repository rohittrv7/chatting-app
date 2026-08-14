import { Module } from '@nestjs/common';
import { NonceGuard } from './nonce.guard';
import { CsrfGuard } from './csrf.guard';

@Module({
  providers: [NonceGuard, CsrfGuard],
  exports: [NonceGuard, CsrfGuard],
})
export class SecurityModule {}
