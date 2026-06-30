import type { Locale } from './client.js';

export interface ApiEndpointDescriptor {
  key: string;
  method: 'GET' | 'POST';
  path: string;
  auth: 'basic' | 'bearer' | 'none';
  title: string;
  description: string;
}

export interface ApiErrorLocalization {
  id: string;
  endpoint_key: string;
  location: string;
  message_uz: string;
  message_ru: string;
  created_at: string;
  updated_at: string;
}

export interface ApiErrorLocalizationInput {
  endpoint_key: string;
  location: string;
  message_uz: string;
  message_ru: string;
}

export interface ApiErrorEnvelope {
  statusCode: number;
  message: string;
  error: string;
  timestamp: string;
  location?: string;
  path: string;
}

export interface LocalizedApiError {
  endpoint_key: string;
  location: string;
  locale: Locale;
  message: string;
}
