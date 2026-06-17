import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import type { LogLevel } from '../src/config/index.js';
import { createLogger } from '../src/utils/logger.js';

const temporaryDirectories: string[] = [];

const createLogsDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'procare-logger-'));
  temporaryDirectories.push(directory);
  return directory;
};

const readSessionLog = async (logsDirectory: string): Promise<string> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const [filename] = fs.readdirSync(logsDirectory);
    if (filename) {
      const content = fs.readFileSync(path.join(logsDirectory, filename), 'utf8');
      if (content.length > 0) return content;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Logger did not persist a session log in time');
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('createLogger', () => {
  it('routes standard levels and persists deep values without ANSI escapes', async () => {
    const logsDirectory = createLogsDirectory();
    const output: {
      debug: string[];
      error: string[];
      info: string[];
      warn: string[];
    } = {
      debug: [],
      error: [],
      info: [],
      warn: [],
    };
    const originalConsole = {
      debug: console.debug,
      error: console.error,
      info: console.info,
      warn: console.warn,
    };

    console.debug = (line?: unknown) => output.debug.push(String(line));
    console.error = (line?: unknown) => output.error.push(String(line));
    console.info = (line?: unknown) => output.info.push(String(line));
    console.warn = (line?: unknown) => output.warn.push(String(line));

    try {
      const logger = createLogger({
        environment: 'production',
        level: 'debug',
        logsDirectory,
      });
      const context = { first: { second: { third: 'visible' } } };

      logger.info('Information', context);
      logger.warn('Warning');
      logger.error('Failure', new Error('broken'));
      logger.debug('Diagnostic');
      logger.extra('Deep diagnostic');

      assert.equal(output.info.length, 1);
      assert.equal(output.warn.length, 1);
      assert.equal(output.error.length, 1);
      assert.equal(output.debug.length, 1);
      assert.match(output.info[0]!, /third/);
      assert.match(output.error[0]!, /Error: broken/);

      const persisted = await readSessionLog(logsDirectory);
      assert.match(persisted, /\[INFO].*Information/);
      assert.match(persisted, /\[WARN].*Warning/);
      assert.match(persisted, /\[ERROR].*Error: broken/);
      assert.match(persisted, /\[DEBUG].*Diagnostic/);
      assert.doesNotMatch(persisted, /Deep diagnostic/);
      assert.match(persisted, /third/);
      assert.equal(persisted.includes('\u001B['), false);
    } finally {
      console.debug = originalConsole.debug;
      console.error = originalConsole.error;
      console.info = originalConsole.info;
      console.warn = originalConsole.warn;
    }
  });

  it('enables debug only for development, debug, and extra-high modes', async () => {
    const calls: string[] = [];
    const enabledLogsDirectories: string[] = [];
    const originalDebug = console.debug;
    console.debug = (line?: unknown) => calls.push(String(line));

    try {
      const cases: Array<{
        environment: string;
        level: LogLevel;
        enabled: boolean;
      }> = [
        { environment: 'production', level: 'info', enabled: false },
        { environment: 'test', level: 'info', enabled: false },
        { environment: 'development', level: 'info', enabled: true },
        { environment: 'production', level: 'debug', enabled: true },
        { environment: 'production', level: 'extra-high', enabled: true },
      ];

      for (const testCase of cases) {
        const before = calls.length;
        const logsDirectory = createLogsDirectory();
        const logger = createLogger({
          environment: testCase.environment,
          level: testCase.level,
          logsDirectory,
        });
        logger.debug('Debug visibility');
        assert.equal(calls.length > before, testCase.enabled);
        if (testCase.enabled) enabledLogsDirectories.push(logsDirectory);
      }

      await Promise.all(enabledLogsDirectories.map(readSessionLog));
    } finally {
      console.debug = originalDebug;
    }
  });

  it('enables extra diagnostics only for extra-high mode', async () => {
    const calls: string[] = [];
    const originalDebug = console.debug;
    console.debug = (line?: unknown) => calls.push(String(line));

    try {
      createLogger({
        environment: 'development',
        level: 'info',
        logsDirectory: createLogsDirectory(),
      }).extra('Extra visibility');
      createLogger({
        environment: 'production',
        level: 'debug',
        logsDirectory: createLogsDirectory(),
      }).extra('Extra visibility');

      assert.equal(calls.length, 0);

      const enabledLogsDirectory = createLogsDirectory();
      createLogger({
        environment: 'production',
        level: 'extra-high',
        logsDirectory: enabledLogsDirectory,
      }).extra('Extra visibility', { safe: true });

      assert.equal(calls.length, 1);
      assert.match(calls[0]!, /\[EXTRA].*Extra visibility/);

      const persisted = await readSessionLog(enabledLogsDirectory);
      assert.match(persisted, /\[EXTRA].*Extra visibility/);
      assert.match(persisted, /safe/);
    } finally {
      console.debug = originalDebug;
    }
  });

  it('prints and persists tables only in development or extra-high mode', async () => {
    const disabledLogsDirectory = createLogsDirectory();
    const enabledLogsDirectory = createLogsDirectory();
    const tableCalls: Array<{ data: unknown; properties?: string[] }> = [];
    const originalTable = console.table;
    console.table = (data?: unknown, properties?: string[]) => {
      tableCalls.push({ data, properties });
    };

    try {
      createLogger({
        environment: 'production',
        level: 'debug',
        logsDirectory: disabledLogsDirectory,
      }).table([{ id: 1 }]);

      const data = [{ id: 2, status: 'ready' }];
      createLogger({
        environment: 'production',
        level: 'extra-high',
        logsDirectory: enabledLogsDirectory,
      }).table(data, ['id']);

      assert.deepEqual(tableCalls, [{ data, properties: ['id'] }]);
      assert.deepEqual(fs.readdirSync(disabledLogsDirectory), []);

      const persisted = await readSessionLog(enabledLogsDirectory);
      assert.match(persisted, /\[TABLE].*\[{"id":2,"status":"ready"}]/);
      assert.equal(persisted.includes('\u001B['), false);
    } finally {
      console.table = originalTable;
    }
  });
});
