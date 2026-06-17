import type { Knex } from 'knex';

import type {
  MessageDispatchLogRecord,
  MessageTemplate,
  MessageTemplateInput,
  MessageTemplateType,
  MessageTemplateUpdate,
} from '../types/message-template.js';
import { isMessageTemplateType } from '../types/message-template.js';
import { escapeHtml } from '../utils/html.js';

export interface MessageTemplateStore {
  listTemplates(): Promise<MessageTemplate[]>;
  findTemplateById(id: string): Promise<MessageTemplate | null>;
  findActiveTemplateByType(type: MessageTemplateType): Promise<MessageTemplate | null>;
  createTemplate(input: MessageTemplateInput): Promise<MessageTemplate>;
  updateTemplate(id: string, update: MessageTemplateUpdate): Promise<MessageTemplate | null>;
  deleteTemplate(id: string): Promise<boolean>;
  logDispatch(record: MessageDispatchLogRecord): Promise<void>;
  setUserBlocked(telegramId: string, isBlocked: boolean): Promise<void>;
}

type MessageTemplateRow = {
  id: string | number;
  template_key: string;
  template_type: string;
  title: string;
  content_uz: string;
  content_ru: string;
  channel: string;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

const asIsoString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

const rowToTemplate = (row: MessageTemplateRow): MessageTemplate => {
  if (!isMessageTemplateType(row.template_type)) {
    throw new Error(`Database returned unsupported message template type: ${row.template_type}`);
  }

  return {
    id: String(row.id),
    template_key: row.template_key,
    template_type: row.template_type,
    title: row.title,
    content_uz: row.content_uz,
    content_ru: row.content_ru,
    channel: row.channel,
    is_active: row.is_active,
    created_at: asIsoString(row.created_at),
    updated_at: asIsoString(row.updated_at),
  };
};

const rowListToTemplates = (rows: MessageTemplateRow[]): MessageTemplate[] =>
  rows.map(rowToTemplate);

export class PostgresMessageTemplateStore implements MessageTemplateStore {
  constructor(private readonly database: Knex) {}

  async listTemplates(): Promise<MessageTemplate[]> {
    const rows = (await this.database('message_templates')
      .select('*')
      .orderBy([
        { column: 'template_type', order: 'asc' },
        { column: 'template_key', order: 'asc' },
      ])) as MessageTemplateRow[];
    return rowListToTemplates(rows);
  }

  async findTemplateById(id: string): Promise<MessageTemplate | null> {
    const row = (await this.database('message_templates').where({ id }).first()) as
      | MessageTemplateRow
      | undefined;
    return row ? rowToTemplate(row) : null;
  }

  async findActiveTemplateByType(type: MessageTemplateType): Promise<MessageTemplate | null> {
    const row = (await this.database('message_templates')
      .where({ template_type: type, is_active: true, channel: 'telegram_bot' })
      .orderBy('updated_at', 'desc')
      .first()) as MessageTemplateRow | undefined;
    return row ? rowToTemplate(row) : null;
  }

  async createTemplate(input: MessageTemplateInput): Promise<MessageTemplate> {
    const rows = (await this.database('message_templates')
      .insert({
        template_key: input.template_key,
        template_type: input.template_type,
        title: input.title,
        content_uz: input.content_uz,
        content_ru: input.content_ru,
        channel: input.channel ?? 'telegram_bot',
        is_active: input.is_active ?? true,
      })
      .returning('*')) as MessageTemplateRow[];

    const created = rows[0];
    if (!created) throw new Error('Database did not return the created message template');
    return rowToTemplate(created);
  }

  async updateTemplate(id: string, update: MessageTemplateUpdate): Promise<MessageTemplate | null> {
    const rows = (await this.database('message_templates')
      .where({ id })
      .update({
        ...update,
        updated_at: this.database.fn.now(),
      })
      .returning('*')) as MessageTemplateRow[];

    const updated = rows[0];
    return updated ? rowToTemplate(updated) : null;
  }

  async deleteTemplate(id: string): Promise<boolean> {
    const deleted = await this.database('message_templates').where({ id }).delete();
    return deleted > 0;
  }

  async logDispatch(record: MessageDispatchLogRecord): Promise<void> {
    await this.database('message_dispatch_logs').insert({
      user_id: record.user_id ?? null,
      template_id: record.template_id ?? null,
      dispatch_type: record.dispatch_type,
      status: record.status,
      error_message: record.error_message ?? null,
    });
  }

  async setUserBlocked(telegramId: string, isBlocked: boolean): Promise<void> {
    await this.database('users')
      .where({ telegram_id: telegramId })
      .update({ is_blocked: isBlocked, updated_at: this.database.fn.now() });
  }
}

export class MessageTemplateRenderer {
  static getContent(template: MessageTemplate, locale: string | null | undefined): string {
    return locale === 'ru' ? template.content_ru : template.content_uz;
  }

  static hasPlaceholder(
    template: MessageTemplate,
    locale: string | null | undefined,
    placeholder: string,
  ): boolean {
    const content = this.getContent(template, locale);
    const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`).test(content);
  }

  static render(
    template: MessageTemplate,
    locale: string | null | undefined,
    placeholders: Record<string, string | number | null | undefined>,
  ): string {
    const raw = this.getContent(template, locale);

    return raw.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string, offset: number) => {
      const value = placeholders[key];
      if (value === null || value === undefined || value === '') return '';

      const stringValue = escapeHtml(String(value));

      if (key === 'coupon_code') {
        const prefix = raw.substring(Math.max(0, offset - 6), offset);
        const suffix = raw.substring(offset + match.length, offset + match.length + 7);
        if (prefix.toLowerCase().endsWith('<code>') && suffix.toLowerCase().startsWith('</code>')) {
          return stringValue;
        }
        return `<code>${stringValue}</code>`;
      }

      return stringValue;
    });
  }
}
