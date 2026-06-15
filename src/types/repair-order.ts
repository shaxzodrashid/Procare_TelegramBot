import type { Locale } from './client.js';

export interface LocalizedCatalogItem {
  id: string;
  name_uz: string;
  name_ru: string;
  name_en: string;
}

export interface OsType extends LocalizedCatalogItem {
  sort: number;
}

export interface PhoneCategory extends LocalizedCatalogItem {
  telegram_sticker: string | null;
  phone_os_type_id: string | null;
  parent_id: string | null;
  sort: number;
  has_children: boolean;
  has_problems: boolean;
}

export interface ProblemCategory extends LocalizedCatalogItem {
  parent_id: null;
  price: string;
  estimated_minutes: number;
  warranty_period: number;
  sort: number;
  cost: string;
}

export interface OpenRepairOrderInput {
  name: string;
  phone_number: string;
  phone_category: string;
  description: string;
}

export interface OpenRepairOrderResult {
  id: string;
  number_id: string;
  user_id: string;
  phone_category_id: string | null;
  phone_number: string;
  name: string;
  description: string | null;
  source: string;
  total: string;
  pricing_currency_id: string;
  sort: number;
  created_at: string;
}

export const localizedCatalogName = (item: LocalizedCatalogItem, locale: Locale): string =>
  item[locale === 'ru' ? 'name_ru' : 'name_uz'] || item.name_en;
