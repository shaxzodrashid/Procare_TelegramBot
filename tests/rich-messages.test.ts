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
      chat: { id: 12345 },
      api: {
        raw: {
          async sendRichMessage(payload: any) {
            calls.push('rich');
            assert.equal(payload.chat_id, 12345);
            assert.deepEqual(payload.rich_message, {
              html: '<h1>Order</h1>',
              skip_entity_detection: true,
            });
            return {};
          },
        },
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
      chat: { id: 12345 },
      api: {
        raw: {
          async sendRichMessage(payload: any) {
            calls.push({ method: 'rich', content: payload.rich_message });
            throw new Error('Bad Request: rich messages unavailable');
          },
        },
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
