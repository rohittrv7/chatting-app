import { Injectable, LoggerService } from '@nestjs/common';
import { colors } from '../utils/logger-colors';

@Injectable()
export class ColorfulLogger implements LoggerService {
  private formatTimestamp(): string {
    const now = new Date();
    const time = now.toTimeString().split(' ')[0];
    return `${colors.gray}[${time}]${colors.reset}`;
  }

  log(message: unknown, context?: string): void {
    this.print('LOG', colors.brightGreen, message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.print('ERROR', colors.brightRed, message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.print('WARN', colors.brightYellow, message, context);
  }

  debug(message: unknown, context?: string): void {
    this.print('DEBUG', colors.brightMagenta, message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.print('VERBOSE', colors.brightCyan, message, context);
  }

  private print(
    level: string,
    levelColor: string,
    message: unknown,
    context?: string,
    trace?: string,
  ): void {
    const time = this.formatTimestamp();
    const tag = `${colors.bold}${colors.brightGreen}[ChatBackend]${colors.reset}`;
    const levelBadge = `${colors.bold}${levelColor}${level.padEnd(5, ' ')}${colors.reset}`;
    const ctx = context ? `${colors.bold}${colors.brightYellow}[${context}]${colors.reset} ` : '';
    const msg = typeof message === 'object' ? JSON.stringify(message, null, 2) : String(message);

    console.log(`${time} ${tag} ${levelBadge} ${ctx}${colors.brightWhite}${msg}${colors.reset}`);
    if (trace) {
      console.error(`${colors.dim}${colors.brightRed}${trace}${colors.reset}`);
    }
  }
}
