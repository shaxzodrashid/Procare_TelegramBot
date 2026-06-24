import type { Knex } from 'knex';

import type { SupportMessageRecord } from '../types/support-message.js';

export interface SupportMessageStore {
  save(record: SupportMessageRecord): Promise<void>;
}

type UserIdRow = { id?: unknown };

const readUserId = (row: UserIdRow | undefined): string | null => {
  const id = row?.id;
  if (typeof id === 'string' || typeof id === 'number') return String(id);
  return null;
};

export class PostgresSupportMessageStore implements SupportMessageStore {
  constructor(private readonly database: Knex) {}

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
