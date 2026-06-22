import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { replySmart } from '../src/bot/rich-messages.js';
import type { BotContext } from '../src/bot/context.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  extra: () => undefined,
  table: () => undefined,
};

describe('replySmart', () => {
  it('uses grammY rich messages when enabled', async () => {
    const calls: string[] = [];
    const ctx = {
      async replyWithRichMessage() {
        calls.push('rich');
        return {};
      },
      async reply() {
        calls.push('fallback');
        return {};
      },
    } as unknown as BotContext;

    await replySmart(
      ctx,
      { richHtml: '<h1>Order</h1>', fallbackHtml: '<b>Order</b>' },
      { enabled: true, logger },
    );

    assert.deepEqual(calls, ['rich']);
  });

  it('falls back to classic HTML when Telegram rejects rich content', async () => {
    const calls: Array<{ method: string; content: unknown; options?: unknown }> = [];
    const ctx = {
      async replyWithRichMessage(content: unknown) {
        calls.push({ method: 'rich', content });
        throw new Error('Bad Request: rich messages unavailable');
      },
      async reply(content: unknown, options: unknown) {
        calls.push({ method: 'fallback', content, options });
        return {};
      },
    } as unknown as BotContext;

    await replySmart(
      ctx,
      { richHtml: '<h1>Order</h1>', fallbackHtml: '<b>Order</b>' },
      { enabled: true, logger },
    );

    assert.equal(calls[0]?.method, 'rich');
    assert.deepEqual(calls[1], {
      method: 'fallback',
      content: '<b>Order</b>',
      options: { parse_mode: 'HTML', reply_markup: undefined },
    });
  });
});
