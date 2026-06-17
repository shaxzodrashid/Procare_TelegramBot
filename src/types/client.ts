export type Locale = 'uz' | 'ru';

export interface LocalizedReference {
  id: string | null;
  name_uz: string | null;
  name_ru: string | null;
  name_en: string | null;
}

export interface RepairOrderStatus extends LocalizedReference {
  color: string | null;
  bg_color: string | null;
}

export interface RepairOrder {
  id: string;
  total: string;
  imei: string | null;
  delivery_method: string | null;
  pickup_method: string | null;
  priority: string | null;
  status: string;
  call_count: number;
  created_at: string;
  description: string | null;
  branch: LocalizedReference;
  phone_category: LocalizedReference;
  repair_order_status: RepairOrderStatus;
}

export interface AdminProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone_number: string;
  phone_verified: boolean;
  language: string | null;
  status: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClientProfile {
  account_type: 'client';
  id: string;
  customer_code: string | null;
  first_name: string | null;
  last_name: string | null;
  phone_number1: string;
  phone_number2: string | null;
  phone_verified: boolean;
  passport_series: string | null;
  birth_date: string | null;
  id_card_number: string | null;
  language: string | null;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  source: string;
  status: string;
  is_active: boolean;
  is_admin: boolean;
  admin: AdminProfile | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  repair_orders: RepairOrder[];
}

export interface AdminRegistration {
  account_type: 'admin';
  is_admin: true;
  admin: AdminProfile;
}

export type RegistrationResult = ClientProfile | AdminRegistration;
