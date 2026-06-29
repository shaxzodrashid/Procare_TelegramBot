import type { Locale } from './client.js';

export const MESSAGE_TEMPLATE_TYPES = [
  'store_visit',
  'purchase',
  'referral',
  'payment_reminder_d2',
  'payment_reminder_d1',
  'payment_reminder_d0',
  'payment_paid_on_time',
  'payment_overdue',
  'payment_paid_late',
  'winner_notification',
  'warranty',
  'offerta',
  'checklist',
] as const;

export type MessageTemplateType = (typeof MESSAGE_TEMPLATE_TYPES)[number];

export const isMessageTemplateType = (value: string): value is MessageTemplateType =>
  MESSAGE_TEMPLATE_TYPES.includes(value as MessageTemplateType);

export interface MessageTemplate {
  id: string;
  template_key: string;
  template_type: MessageTemplateType;
  title: string;
  content_uz: string;
  content_ru: string;
  channel: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type MessageTemplateField =
  | 'template_key'
  | 'template_type'
  | 'title'
  | 'content_uz'
  | 'content_ru';

export interface MessageTemplateDraft {
  template_key?: string;
  template_type?: MessageTemplateType;
  title?: string;
  content_uz?: string;
  content_ru?: string;
}

export interface MessageTemplateInput extends Required<
  Pick<MessageTemplate, 'template_key' | 'template_type' | 'title'>
> {
  content_uz: string;
  content_ru: string;
  channel?: string;
  is_active?: boolean;
}

export type MessageTemplateUpdate = Partial<
  Pick<
    MessageTemplate,
    'template_key' | 'template_type' | 'title' | 'content_uz' | 'content_ru' | 'is_active'
  >
>;

export type MessageDispatchStatus = 'sent' | 'failed' | 'template_not_found';

export interface MessageDispatchLogRecord {
  user_id?: string | null;
  template_id?: string | null;
  dispatch_type: string;
  status: MessageDispatchStatus;
  error_message?: string | null;
}

export interface TemplateRecipient {
  id?: string | null;
  telegram_id: string;
  language_code?: Locale | string | null;
  is_blocked?: boolean | null;
}
