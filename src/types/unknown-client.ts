import type { Locale } from './client.js';

export type UnknownClientDeclineReason = 'declined_offer' | 'cancelled_confirmation';

export interface UnknownClientRecord {
  telegram_user_id: string;
  telegram_chat_id: string;
  telegram_username: string | null;
  first_name: string;
  last_name: string | null;
  phone_number: string;
  locale: Locale;
  reason: UnknownClientDeclineReason;
  saved_at: string;
}
