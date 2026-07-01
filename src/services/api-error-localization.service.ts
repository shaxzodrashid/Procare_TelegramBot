import type { Knex } from 'knex';

import type {
  ApiEndpointDescriptor,
  ApiErrorEnvelope,
  ApiErrorLocalization,
  ApiErrorLocalizationInput,
  LocalizedApiError,
} from '../types/api-error-localization.js';
import type { Locale } from '../types/client.js';

export const API_ENDPOINTS: readonly ApiEndpointDescriptor[] = [
  {
    key: 'client_registration',
    method: 'POST',
    path: '/api/v1/users/register-client',
    auth: 'basic',
    title: 'Client registration',
    description: 'Looks up a Telegram user by normalized phone number.',
  },
  {
    key: 'client_repair_orders',
    method: 'GET',
    path: '/api/v1/telegram/clients/{clientId}/repair-orders',
    auth: 'basic',
    title: 'Client repair orders',
    description: 'Lists repair orders visible to a registered client.',
  },
  {
    key: 'client_repair_order_detail',
    method: 'GET',
    path: '/api/v1/telegram/clients/{clientId}/repair-orders/{orderNumber}',
    auth: 'basic',
    title: 'Client repair order detail',
    description: 'Fetches one visible repair-order card for a registered client.',
  },
  {
    key: 'support_comment',
    method: 'POST',
    path: '/api/v1/repair-orders/register-comment/{repairOrderId}',
    auth: 'basic',
    title: 'Support comment',
    description: 'Sends a customer support comment from a repair-order card.',
  },
  {
    key: 'calculator_os_types',
    method: 'GET',
    path: '/api/v1/calculator/os-types',
    auth: 'none',
    title: 'Calculator OS types',
    description: 'Loads public operating-system options for repair requests.',
  },
  {
    key: 'calculator_phone_categories',
    method: 'GET',
    path: '/api/v1/calculator/phone-categories/{osTypeId}',
    auth: 'none',
    title: 'Calculator phone categories',
    description: 'Loads public phone category pages for repair requests.',
  },
  {
    key: 'calculator_problem_categories',
    method: 'GET',
    path: '/api/v1/calculator/problem-categories/{phoneCategoryId}',
    auth: 'none',
    title: 'Calculator problem categories',
    description: 'Loads public problem choices for a selected phone category.',
  },
  {
    key: 'public_repair_order_open',
    method: 'POST',
    path: '/api/v1/repair-orders/open/telegram',
    auth: 'none',
    title: 'Public repair-order creation',
    description: 'Creates a public repair request for an unknown Telegram client.',
  },
] as const;

export interface ApiErrorLocalizationStore {
  listEndpoints(): readonly ApiEndpointDescriptor[];
  getEndpoint(endpointKey: string): ApiEndpointDescriptor | null;
  listLocalizations(endpointKey: string): Promise<ApiErrorLocalization[]>;
  findLocalization(endpointKey: string, location: string): Promise<ApiErrorLocalization | null>;
  upsertLocalization(input: ApiErrorLocalizationInput): Promise<ApiErrorLocalization>;
  resolveEnvelope(
    endpointKey: string,
    envelope: ApiErrorEnvelope,
    locale: Locale,
  ): Promise<LocalizedApiError | null>;
}

type LocalizationRow = {
  id: string | number;
  endpoint_key: string;
  location: string;
  message_uz: string;
  message_ru: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type ReturnedLocalizationId = { id?: unknown } | string | number;

const LOCATION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/;

const normalizeDate = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : String(value);

const toLocalization = (row: LocalizationRow): ApiErrorLocalization => ({
  id: String(row.id),
  endpoint_key: row.endpoint_key,
  location: row.location,
  message_uz: row.message_uz,
  message_ru: row.message_ru,
  created_at: normalizeDate(row.created_at),
  updated_at: normalizeDate(row.updated_at),
});

const parseReturnedId = (rows: ReturnedLocalizationId[]): string => {
  const first = rows[0];
  const id = typeof first === 'object' && first !== null ? first.id : first;
  if (typeof id === 'string' || typeof id === 'number') return String(id);
  throw new Error('Database did not return an API error localization ID');
};

export const validateApiErrorLocalizationInput = (
  input: ApiErrorLocalizationInput,
  endpoints: readonly ApiEndpointDescriptor[] = API_ENDPOINTS,
): string[] => {
  const issues: string[] = [];
  if (!endpoints.some((endpoint) => endpoint.key === input.endpoint_key)) {
    issues.push('endpoint_key is not registered');
  }
  if (!LOCATION_PATTERN.test(input.location)) {
    issues.push(
      'location must be 1-120 characters and use letters, numbers, dots, colons, underscores, or dashes',
    );
  }
  if (input.message_uz.trim().length < 2 || input.message_uz.length > 1000) {
    issues.push('message_uz must be 2-1000 characters');
  }
  if (input.message_ru.trim().length < 2 || input.message_ru.length > 1000) {
    issues.push('message_ru must be 2-1000 characters');
  }
  return issues;
};

export const isApiErrorEnvelope = (value: unknown): value is ApiErrorEnvelope => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.statusCode === 'number' &&
    typeof record.message === 'string' &&
    typeof record.error === 'string' &&
    typeof record.timestamp === 'string' &&
    typeof record.path === 'string' &&
    (record.location === undefined || typeof record.location === 'string')
  );
};

export class PostgresApiErrorLocalizationStore implements ApiErrorLocalizationStore {
  constructor(
    private readonly database: Knex,
    private readonly endpoints: readonly ApiEndpointDescriptor[] = API_ENDPOINTS,
  ) {}

  listEndpoints(): readonly ApiEndpointDescriptor[] {
    return this.endpoints;
  }

  getEndpoint(endpointKey: string): ApiEndpointDescriptor | null {
    return this.endpoints.find((endpoint) => endpoint.key === endpointKey) ?? null;
  }

  async listLocalizations(endpointKey: string): Promise<ApiErrorLocalization[]> {
    const rows = (await this.database('api_error_localizations')
      .select(
        'id',
        'endpoint_key',
        'location',
        'message_uz',
        'message_ru',
        'created_at',
        'updated_at',
      )
      .where({ endpoint_key: endpointKey })
      .orderBy('location', 'asc')) as LocalizationRow[];
    return rows.map(toLocalization);
  }

  async findLocalization(
    endpointKey: string,
    location: string,
  ): Promise<ApiErrorLocalization | null> {
    const row = (await this.database('api_error_localizations')
      .where({ endpoint_key: endpointKey, location })
      .first()) as LocalizationRow | undefined;
    return row ? toLocalization(row) : null;
  }

  async upsertLocalization(input: ApiErrorLocalizationInput): Promise<ApiErrorLocalization> {
    const normalizedInput = {
      endpoint_key: input.endpoint_key,
      location: input.location.trim(),
      message_uz: input.message_uz.trim(),
      message_ru: input.message_ru.trim(),
    };
    const issues = validateApiErrorLocalizationInput(normalizedInput, this.endpoints);
    if (issues.length > 0) throw new Error(issues.join('; '));

    const rows = (await this.database('api_error_localizations')
      .insert(normalizedInput)
      .onConflict(['endpoint_key', 'location'])
      .merge({
        message_uz: normalizedInput.message_uz,
        message_ru: normalizedInput.message_ru,
        updated_at: this.database.fn.now(),
      })
      .returning('id')) as ReturnedLocalizationId[];

    const id = parseReturnedId(rows);
    const saved = await this.database('api_error_localizations').where({ id }).first();
    if (!saved) throw new Error('Saved API error localization could not be read back');
    return toLocalization(saved as LocalizationRow);
  }

  async resolveEnvelope(
    endpointKey: string,
    envelope: ApiErrorEnvelope,
    locale: Locale,
  ): Promise<LocalizedApiError | null> {
    if (!envelope.location) return null;
    const localization = await this.findLocalization(endpointKey, envelope.location);
    if (!localization) return null;
    return {
      endpoint_key: endpointKey,
      location: envelope.location,
      locale,
      message: locale === 'ru' ? localization.message_ru : localization.message_uz,
    };
  }
}
