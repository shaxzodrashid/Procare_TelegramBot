import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BotLifecycleNotificationService } from '../src/services/lifecycle-notification.service.js';
import type { RegisteredUserMessageTarget } from '../src/types/registered-user.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  extra: () => undefined,
  table: () => undefined,
};

const user = (
  id: string,
  telegramId: string,
  locale: 'uz' | 'ru',
): RegisteredUserMessageTarget => ({
  id,
  telegram_id: telegramId,
  telegram_username: null,
  first_name: 'Test',
  last_name: null,
  phone_number: '+998901234567',
  locale,
  is_blocked: false,
});

describe('BotLifecycleNotificationService', () => {
  it('sends startup notices in batches and marks blocked users', async () => {
    const targets = [user('1', '1001', 'uz'), user('2', '1002', 'ru'), user('3', '1003', 'uz')];
    const listCalls: unknown[] = [];
    const blockedUpdates: unknown[] = [];
    const dispatchLogs: unknown[] = [];
    const telegramCalls: Array<{ chatId: string | number; text: string; options: unknown }> = [];
    const service = new BotLifecycleNotificationService(
      {
        async listMessageTargets(params) {
          listCalls.push(params);
          const afterId = params.afterId ? Number(params.afterId) : 0;
          return targets.filter((target) => Number(target.id) > afterId).slice(0, params.limit);
        },
      },
      {
        async setUserBlocked(telegramId, isBlocked) {
          blockedUpdates.push({ telegramId, isBlocked });
        },
        async logDispatch(record) {
          dispatchLogs.push(record);
        },
      },
      {
        async sendMessage(chatId, text, options) {
          telegramCalls.push({ chatId, text, options });
          if (chatId === '1003') {
            throw { error_code: 403, description: 'Forbidden: bot was blocked by the user' };
          }
          return {} as never;
        },
      },
      logger,
      { batchSize: 2, concurrency: 2 },
    );

    const summary = await service.notifyStartup(10_000);

    assert.deepEqual(listCalls, [
      { afterId: undefined, limit: 2, includeBlocked: false },
      { afterId: '2', limit: 2, includeBlocked: false },
    ]);
    assert.equal(summary.kind, 'startup');
    assert.equal(summary.total, 3);
    assert.equal(summary.sent, 2);
    assert.equal(summary.blocked, 1);
    assert.equal(summary.failed, 0);
    assert.equal(summary.timedOut, false);
    assert.equal(telegramCalls[0]?.text.includes('/start'), true);
    assert.deepEqual(telegramCalls[0]?.options, {
      reply_markup: {
        keyboard: [[{ text: '/start' }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
    assert.deepEqual(blockedUpdates, [
      { telegramId: '1001', isBlocked: false },
      { telegramId: '1002', isBlocked: false },
      { telegramId: '1003', isBlocked: true },
    ]);
    assert.equal(dispatchLogs.length, 3);
  });

  it('sends shutdown apologies and removes reply keyboards', async () => {
    const telegramCalls: Array<{ options: unknown; text: string }> = [];
    const service = new BotLifecycleNotificationService(
      {
        async listMessageTargets() {
          return [user('1', '1001', 'ru')];
        },
      },
      {
        async setUserBlocked() {},
        async logDispatch() {},
      },
      {
        async sendMessage(_chatId, text, options) {
          telegramCalls.push({ text, options });
          return {} as never;
        },
      },
      logger,
      { batchSize: 10, concurrency: 1 },
    );

    const summary = await service.notifyShutdown(10_000);

    assert.equal(summary.sent, 1);
    assert.equal(telegramCalls[0]?.text.includes('извинения'), true);
    assert.deepEqual(telegramCalls[0]?.options, {
      reply_markup: {
        remove_keyboard: true,
      },
    });
  });
});
