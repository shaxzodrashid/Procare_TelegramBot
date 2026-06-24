import type { Locale } from './client.js';

export interface RegisteredTelegramUserRecord {
  telegram_id: string;
  telegram_username: string | null;
  first_name: string;
  last_name: string | null;
  phone_number: string;
  locale: Locale;
}

export interface RegisteredClientRecord extends RegisteredTelegramUserRecord {
  crm_client_id: string;
  customer_code: string | null;
  status: string;
  is_active: boolean;
}

export interface RegisteredEmployeeRecord extends RegisteredTelegramUserRecord {
  crm_admin_id: string;
  status: string;
  is_active: boolean;
}

export interface RegisteredUserSettingsUpdate {
  telegram_id: string;
  telegram_username?: string | null;
  first_name?: string;
  last_name?: string | null;
  locale?: Locale;
}

export interface RegisteredUserMessageTarget {
  id: string;
  telegram_id: string;
  phone_number: string;
  is_blocked: boolean;
}

export interface UserRegistrationState {
  user: {
    telegram_id: string;
    telegram_username: string | null;
    first_name: string;
    last_name: string | null;
    phone_number: string;
    locale: Locale;
  };
  client?: {
    crm_client_id: string;
    customer_code: string | null;
    status: string;
    is_active: boolean;
  };
  employee?: {
    crm_admin_id: string;
    status: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  };
}
