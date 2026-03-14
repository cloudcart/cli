import { colors } from '../ui/colors.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let currentLevel: LogLevel = 'info';

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return levels[level] >= levels[currentLevel];
}

export const logger = {
  debug(message: string): void {
    if (shouldLog('debug')) {
      console.error(colors.dim(`[debug] ${message}`));
    }
  },
  info(message: string): void {
    if (shouldLog('info')) {
      console.error(message);
    }
  },
  success(message: string): void {
    if (shouldLog('info')) {
      console.error(colors.success(`✓ ${message}`));
    }
  },
  warn(message: string): void {
    if (shouldLog('warn')) {
      console.error(colors.warning(`⚠ ${message}`));
    }
  },
  error(message: string): void {
    if (shouldLog('error')) {
      console.error(colors.error(`✗ ${message}`));
    }
  },
};
