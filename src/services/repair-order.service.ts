import type {
  LocalizedCatalogItem,
  OpenRepairOrderInput,
  OpenRepairOrderResult,
  OsType,
  PhoneCategory,
  ProblemCategory,
} from '../types/repair-order.js';
import {
  redactPhoneNumber,
  redactPhoneNumbersInText,
  summarizeText,
  summarizeUnknownPayload,
} from '../utils/log-redaction.js';
import type { Logger } from '../utils/logger.js';

export type RepairOrderFailureCode =
  | 'invalid_request'
  | 'duplicate'
  | 'rate_limited'
  | 'maintenance'
  | 'unavailable'
  | 'invalid_response';

export class RepairOrderError extends Error {
  constructor(
    public readonly code: RepairOrderFailureCode,
    message: string,
    public readonly status?: number,
    public readonly location?: string,
  ) {
    super(message);
    this.name = 'RepairOrderError';
  }
}

export interface RepairOrderGateway {
  getOsTypes(): Promise<OsType[]>;
  getPhoneCategories(osTypeId: string, parentId?: string): Promise<PhoneCategory[]>;
  getProblemCategories(phoneCategoryId: string): Promise<ProblemCategory[]>;
  createOpenRepairOrder(input: OpenRepairOrderInput): Promise<OpenRepairOrderResult>;
}

interface ErrorEnvelope {
  message?: string;
  location?: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const isLocalizedItem = (value: unknown): boolean =>
  isObject(value) &&
  typeof value.id === 'string' &&
  typeof value.name_uz === 'string' &&
  typeof value.name_ru === 'string' &&
  typeof value.name_en === 'string';

const isOsTypes = (value: unknown): value is OsType[] =>
  Array.isArray(value) && value.every((item) => isLocalizedItem(item));

const isPhoneCategories = (value: unknown): value is PhoneCategory[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      isLocalizedItem(item) &&
      typeof item.has_children === 'boolean' &&
      typeof item.has_problems === 'boolean',
  );

const isProblemCategories = (value: unknown): value is ProblemCategory[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      isLocalizedItem(item) && typeof item.cost === 'string' && typeof item.price === 'string',
  );

const isOpenRepairOrderResult = (value: unknown): value is OpenRepairOrderResult =>
  isObject(value) &&
  typeof value.id === 'string' &&
  typeof value.number_id === 'string' &&
  typeof value.phone_number === 'string';

const summarizeCatalogItem = (item: LocalizedCatalogItem): Record<string, unknown> => ({
  id: item.id,
  name_uz: item.name_uz,
  name_ru: item.name_ru,
  name_en: item.name_en,
  has_children: isObject(item) ? item.has_children : undefined,
  has_problems: isObject(item) ? item.has_problems : undefined,
  price: isObject(item) ? item.price : undefined,
  cost: isObject(item) ? item.cost : undefined,
});

const summarizeOpenRepairOrderInput = (input: OpenRepairOrderInput): Record<string, unknown> => ({
  name_present: input.name.trim().length > 0,
  phone_number: redactPhoneNumber(input.phone_number),
  phone_category: input.phone_category,
  description: summarizeText(input.description),
});

const summarizeOpenRepairOrderResult = (
  result: OpenRepairOrderResult,
): Record<string, unknown> => ({
  id: result.id,
  number_id: result.number_id,
  user_id: result.user_id,
  phone_category_id: result.phone_category_id,
  phone_number: redactPhoneNumber(result.phone_number),
  name_present: result.name.trim().length > 0,
  description: summarizeText(result.description),
  source: result.source,
  total: result.total,
});

const summarizeRequestBody = (body: BodyInit | null | undefined): unknown => {
  if (typeof body !== 'string') return summarizeUnknownPayload(body);
  try {
    const parsed = JSON.parse(body) as unknown;
    if (
      isObject(parsed) &&
      typeof parsed.name === 'string' &&
      typeof parsed.phone_number === 'string' &&
      typeof parsed.phone_category === 'string' &&
      typeof parsed.description === 'string'
    ) {
      return summarizeOpenRepairOrderInput({
        name: parsed.name,
        phone_number: parsed.phone_number,
        phone_category: parsed.phone_category,
        description: parsed.description,
      });
    }
    return summarizeUnknownPayload(parsed);
  } catch {
    return { type: 'string', length: body.length };
  }
};

const summarizeRepairPayload = (payload: unknown): unknown => {
  if (Array.isArray(payload)) {
    return {
      type: 'array',
      count: payload.length,
      sample: payload
        .filter((item): item is LocalizedCatalogItem => isLocalizedItem(item))
        .slice(0, 3)
        .map(summarizeCatalogItem),
    };
  }
  if (isOpenRepairOrderResult(payload)) return summarizeOpenRepairOrderResult(payload);
  if (isObject(payload) && typeof payload.message === 'string') {
    return { message: redactPhoneNumbersInText(payload.message) };
  }
  return summarizeUnknownPayload(payload);
};

export class HttpRepairOrderService implements RepairOrderGateway {
  constructor(
    private readonly options: {
      baseUrl: string;
      timeoutMs: number;
      maxRetries: number;
      fetchImpl?: typeof fetch;
      sleep?: (ms: number) => Promise<void>;
    },
    private readonly logger: Logger,
  ) {}

  getOsTypes(): Promise<OsType[]> {
    return this.request('/api/v1/calculator/os-types', undefined, isOsTypes);
  }

  getPhoneCategories(osTypeId: string, parentId?: string): Promise<PhoneCategory[]> {
    const query = parentId ? `?${new URLSearchParams({ parent_id: parentId })}` : '';
    return this.request(
      `/api/v1/calculator/phone-categories/${encodeURIComponent(osTypeId)}${query}`,
      undefined,
      isPhoneCategories,
    );
  }

  getProblemCategories(phoneCategoryId: string): Promise<ProblemCategory[]> {
    return this.request(
      `/api/v1/calculator/problem-categories/${encodeURIComponent(phoneCategoryId)}`,
      undefined,
      isProblemCategories,
    );
  }

  createOpenRepairOrder(input: OpenRepairOrderInput): Promise<OpenRepairOrderResult> {
    return this.request(
      '/api/v1/repair-orders/open/telegram',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
      isOpenRepairOrderResult,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit | undefined,
    validator: (value: unknown) => value is T,
  ): Promise<T> {
    const attempts = init?.method === 'POST' ? 1 : this.options.maxRetries + 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.requestOnce(path, init, validator);
      } catch (error) {
        const retryable =
          error instanceof RepairOrderError &&
          (error.code === 'maintenance' || error.code === 'unavailable');
        if (!retryable || attempt === attempts) throw error;

        const delayMs = 250 * 2 ** (attempt - 1);
        this.logger.warn(`Public repair API attempt ${attempt} failed; retrying in ${delayMs}ms`, {
          path,
          code: error.code,
          status: error.status,
        });
        await (this.options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(
          delayMs,
        );
      }
    }

    throw new RepairOrderError('unavailable', 'Public repair API request failed');
  }

  private async requestOnce<T>(
    path: string,
    init: RequestInit | undefined,
    validator: (value: unknown) => value is T,
  ): Promise<T> {
    let response: Response;
    const method = init?.method ?? 'GET';
    this.logger.extra('Public repair API request', {
      method,
      path,
      headers: {
        accept: 'application/json',
        'content-type': new Headers(init?.headers).get('content-type') ?? undefined,
      },
      body: init?.body ? summarizeRequestBody(init.body) : undefined,
      timeoutMs: this.options.timeoutMs,
    });

    try {
      response = await (this.options.fetchImpl ?? fetch)(`${this.options.baseUrl}${path}`, {
        ...init,
        headers: { accept: 'application/json', ...init?.headers },
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      this.logger.error(`Public repair API network request failed for ${path}`, error);
      throw new RepairOrderError('unavailable', 'Public repair API is unavailable');
    }

    const payload = (await response.json().catch(() => null)) as ErrorEnvelope | T | null;
    this.logger.extra('Public repair API response', {
      method,
      path,
      status: response.status,
      ok: response.ok,
      body: summarizeRepairPayload(payload),
    });

    if (response.ok) {
      if (!validator(payload)) {
        throw new RepairOrderError('invalid_response', 'Public repair API returned invalid data');
      }
      return payload;
    }

    const envelope = isObject(payload) ? payload : null;
    const message =
      typeof envelope?.message === 'string'
        ? envelope.message
        : `Public repair API request failed with status ${response.status}`;
    const location = typeof envelope?.location === 'string' ? envelope.location : undefined;

    if (response.status === 400 || response.status === 409 || response.status === 422) {
      if (location === 'telegram_open_repair_order_duplicate') {
        throw new RepairOrderError('duplicate', message, response.status, location);
      }
      throw new RepairOrderError('invalid_request', message, response.status, location);
    }
    if (response.status === 429) {
      throw new RepairOrderError('rate_limited', message, response.status, location);
    }
    if (response.status === 503) {
      throw new RepairOrderError('maintenance', message, response.status, location);
    }
    throw new RepairOrderError('unavailable', message, response.status, location);
  }
}
