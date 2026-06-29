import type { Knex } from 'knex';

import type { SupportMessageRecord, SupportMessageReplyTarget } from '../types/support-message.js';

export interface SupportMessageStore {
  save(record: SupportMessageRecord): Promise<void>;
  findReplyTargetByCrmCommentId(
    crmCommentId: string,
    telegramId: string,
  ): Promise<SupportMessageReplyTarget | null>;
}

type UserIdRow = { id?: unknown };
type SupportMessageReplyTargetRow = {
  id?: unknown;
  telegram_id?: unknown;
  telegram_chat_id?: unknown;
  telegram_message_id?: unknown;
};

const readUserId = (row: UserIdRow | undefined): string | null => {
  const id = row?.id;
  if (typeof id === 'string' || typeof id === 'number' || typeof id === 'bigint') return String(id);
  return null;
};

const readRequiredString = (value: unknown): string | null => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return null;
};

const readRequiredInteger = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return null;
};

export class PostgresSupportMessageStore implements SupportMessageStore {
  constructor(private readonly database: Knex) {}

  async findReplyTargetByCrmCommentId(
    crmCommentId: string,
    telegramId: string,
  ): Promise<SupportMessageReplyTarget | null> {
    const row = (await this.database('support_messages')
      .select('id', 'telegram_id', 'telegram_chat_id', 'telegram_message_id')
      .where({ crm_comment_id: crmCommentId, telegram_id: telegramId })
      .first()) as SupportMessageReplyTargetRow | undefined;

    const id = readRequiredString(row?.id);
    const rowTelegramId = readRequiredString(row?.telegram_id);
    const telegramChatId = readRequiredString(row?.telegram_chat_id);
    const telegramMessageId = readRequiredInteger(row?.telegram_message_id);
    if (!id || !rowTelegramId || !telegramChatId || telegramMessageId === null) return null;

    return {
      id,
      telegram_id: rowTelegramId,
      telegram_chat_id: telegramChatId,
      telegram_message_id: telegramMessageId,
    };
  }

  async save(record: SupportMessageRecord): Promise<void> {
    await this.database.transaction(async (trx) => {
      const userRow = (await trx('users')
        .select('id')
        .where({ telegram_id: record.telegram_id })
        .first()) as UserIdRow | undefined;
      const userId = record.user_id ?? readUserId(userRow);

      await trx('support_messages')
        .insert({
          crm_comment_id: record.crm_comment_id,
          crm_client_id: record.crm_client_id,
          repair_order_id: record.repair_order_id,
          order_number: record.order_number,
          user_id: userId,
          telegram_id: record.telegram_id,
          telegram_chat_id: record.telegram_chat_id,
          telegram_message_id: record.telegram_message_id,
          telegram_message_date: record.telegram_message_date,
          sender_type: record.sender_type,
          direction: record.direction,
          content_type: record.content_type,
          text: record.text,
          photo_count: record.photo_count,
          reply_to_support_message_id: record.reply_to_support_message_id ?? null,
        })
        .onConflict(['telegram_chat_id', 'telegram_message_id'])
        .merge({
          crm_comment_id: record.crm_comment_id,
          crm_client_id: record.crm_client_id,
          repair_order_id: record.repair_order_id,
          order_number: record.order_number,
          user_id: userId,
          telegram_id: record.telegram_id,
          telegram_message_date: record.telegram_message_date,
          sender_type: record.sender_type,
          direction: record.direction,
          content_type: record.content_type,
          text: record.text,
          photo_count: record.photo_count,
          reply_to_support_message_id: record.reply_to_support_message_id ?? null,
          updated_at: trx.fn.now(),
        });
    });
  }
}
