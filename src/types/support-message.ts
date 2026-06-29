export type SupportMessageSenderType = 'client' | 'employee';
export type SupportMessageDirection = 'inbound' | 'outbound';
export type SupportMessageContentType = 'text' | 'photo';

export interface SupportMessageRecord {
  crm_comment_id: string;
  crm_client_id: string;
  repair_order_id: string;
  order_number: string;
  user_id?: string | null;
  telegram_id: string;
  telegram_chat_id: string;
  telegram_message_id: number;
  telegram_message_date: Date | null;
  sender_type: SupportMessageSenderType;
  direction: SupportMessageDirection;
  content_type: SupportMessageContentType;
  text: string | null;
  photo_count: number;
  reply_to_support_message_id?: string | null;
}

export interface SupportMessageReplyTarget {
  id: string;
  telegram_id: string;
  telegram_chat_id: string;
  telegram_message_id: number;
}
