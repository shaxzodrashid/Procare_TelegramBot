import type { InlineKeyboard } from 'grammy';

import type { Logger } from '../utils/logger.js';
import type { BotContext } from './context.js';

export interface SmartReplyContent {
  richHtml: string;
  fallbackHtml: string;
}

export const replySmart = async (
  ctx: BotContext,
  content: SmartReplyContent,
  options: {
    enabled: boolean;
    logger: Logger;
    replyMarkup?: InlineKeyboard;
  },
): Promise<void> => {
  const chatId = ctx.chat?.id;

  if (options.enabled && chatId) {
    try {
      await (ctx.api.raw as any).sendRichMessage({
        chat_id: chatId,
        rich_message: {
          html: content.richHtml,
          skip_entity_detection: true,
        },
        reply_markup: options.replyMarkup,
      });
      return;
    } catch (error) {
      options.logger.warn('Telegram rich message failed; using HTML fallback', error);
    }
  }

  await ctx.reply(content.fallbackHtml, {
    parse_mode: 'HTML',
    reply_markup: options.replyMarkup,
  });
};
