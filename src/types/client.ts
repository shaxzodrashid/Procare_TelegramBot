export type Locale = 'uz' | 'ru';

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
  client_id: string;
  first_name: string | null;
  last_name: string | null;
  phone_number?: string | null;
  language: string | null;
  has_repair_orders: boolean;
  is_admin: boolean;
  admin: AdminProfile | null;
}

export interface AdminRegistration {
  account_type: 'admin';
  is_admin: true;
  admin: AdminProfile;
}

export type RegistrationResult = ClientProfile | AdminRegistration;
