/**
 * ANSI Color and Terminal Formatting Utilities for Colorful Logging
 */

export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // High intensity bright foreground colors
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
  bgGray: '\x1b[100m',
};

/**
 * Returns a padded and color-coded HTTP method badge
 */
export function colorizeMethod(method: string): string {
  const m = method.toUpperCase();
  switch (m) {
    case 'GET':
      return `${colors.bold}${colors.brightGreen} GET    ${colors.reset}`;
    case 'POST':
      return `${colors.bold}${colors.brightCyan} POST   ${colors.reset}`;
    case 'PUT':
      return `${colors.bold}${colors.brightYellow} PUT    ${colors.reset}`;
    case 'PATCH':
      return `${colors.bold}${colors.brightMagenta} PATCH  ${colors.reset}`;
    case 'DELETE':
      return `${colors.bold}${colors.brightRed} DELETE ${colors.reset}`;
    case 'OPTIONS':
      return `${colors.dim}${colors.cyan} OPTION ${colors.reset}`;
    case 'HEAD':
      return `${colors.dim}${colors.gray} HEAD   ${colors.reset}`;
    default:
      return `${colors.bold}${colors.white} ${m.padEnd(6, ' ')} ${colors.reset}`;
  }
}

/**
 * Returns color-coded HTTP status code with status description
 */
export function colorizeStatus(status: number): string {
  if (status >= 200 && status < 300) {
    return `${colors.bold}${colors.brightGreen}${status} OK${colors.reset}`;
  }
  if (status >= 300 && status < 400) {
    return `${colors.bold}${colors.brightCyan}${status} REDIRECT${colors.reset}`;
  }
  if (status >= 400 && status < 500) {
    return `${colors.bold}${colors.brightYellow}${status} CLIENT_ERROR${colors.reset}`;
  }
  if (status >= 500) {
    return `${colors.bold}${colors.bgRed}${colors.brightWhite} ${status} SERVER_ERROR ${colors.reset}`;
  }
  return `${colors.bold}${colors.white}${status}${colors.reset}`;
}

/**
 * Returns color-coded duration (response time in ms)
 */
export function colorizeDuration(ms: number): string {
  const rounded = Math.round(ms * 10) / 10;
  const str = `+${rounded}ms`;
  if (ms < 50) {
    return `${colors.brightGreen}${str.padStart(7, ' ')}${colors.reset}`;
  }
  if (ms < 200) {
    return `${colors.brightYellow}${str.padStart(7, ' ')}${colors.reset}`;
  }
  return `${colors.bold}${colors.brightRed}${str.padStart(7, ' ')}${colors.reset}`;
}

/**
 * Format bytes to readable size
 */
export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Formats a timestamp [HH:MM:SS] in dim gray
 */
export function getTimestamp(): string {
  const now = new Date();
  const time = now.toTimeString().split(' ')[0];
  return `${colors.gray}[${time}]${colors.reset}`;
}
