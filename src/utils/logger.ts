import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';

import type { LogLevel } from '../config/index.js';

export interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  table(tabularData: unknown, properties?: string[]): void;
}

// ANSI escapes are intentionally matched so terminal colors are not persisted to log files.
// eslint-disable-next-line no-control-regex
const ansiPattern = new RegExp('\\u001B\\[[0-9;]*m', 'g');
const stripAnsi = (value: string): string => value.replace(ansiPattern, '');

const formatValue = (value: unknown, colors: boolean): string => {
  if (typeof value === 'object' && value !== null) {
    return util.inspect(value, { colors, depth: null, showHidden: false });
  }
  return String(value);
};

const serializeTableData = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return util.inspect(value, { colors: false, depth: null, showHidden: false });
  }
};

export const createLogger = (options: {
  level: LogLevel;
  environment: string;
  logsDirectory?: string;
}): Logger => {
  const logsDirectory = options.logsDirectory ?? path.resolve(process.cwd(), 'logs');
  fs.mkdirSync(logsDirectory, { recursive: true });

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const sessionLogFile = path.join(logsDirectory, `${date}_${hour}-${minute}.log`);
  const debugEnabled =
    options.environment === 'development' ||
    options.level === 'debug' ||
    options.level === 'extra-high';
  const tableEnabled = options.environment === 'development' || options.level === 'extra-high';

  const writeToFile = (line: string): void => {
    fs.appendFile(sessionLogFile, `${stripAnsi(line)}\n`, 'utf8', (error) => {
      if (error) {
        process.stderr.write(`[LOGGER] Failed to write to log file: ${error.message}\n`);
      }
    });
  };

  const write = (
    level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG',
    message: string,
    args: unknown[],
  ): void => {
    const timestamp = new Date().toISOString();
    const consoleLine = [
      `[${level}] ${timestamp} - ${message}`,
      ...args.map((v) => formatValue(v, true)),
    ].join(' ');
    const output =
      level === 'ERROR'
        ? console.error
        : level === 'WARN'
          ? console.warn
          : level === 'DEBUG'
            ? console.debug
            : console.info;

    output(consoleLine);
    writeToFile(consoleLine);
  };

  return {
    info: (message, ...args) => write('INFO', message, args),
    warn: (message, ...args) => write('WARN', message, args),
    error: (message, ...args) => write('ERROR', message, args),
    debug: (message, ...args) => {
      if (debugEnabled) write('DEBUG', message, args);
    },
    table: (tabularData, properties) => {
      if (!tableEnabled) return;

      console.table(tabularData, properties);
      writeToFile(`[TABLE] ${new Date().toISOString()} - ${serializeTableData(tabularData)}`);
    },
  };
};
