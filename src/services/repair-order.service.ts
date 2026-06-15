import type {
  OpenRepairOrderInput,
  OpenRepairOrderResult,
  OsType,
  PhoneCategory,
  ProblemCategory,
} from '../types/repair-order.js';
import type { Logger } from '../utils/logger.js';

export type RepairOrderFailureCode =
  | 'invalid_request'
  | 'rate_limited'
  | 'maintenance'
  | 'unavailable'
  | 'invalid_response';

export class RepairOrderError extends Error {
  constructor(
    public readonly code: RepairOrderFailureCode,
    message: string,
    public readonly status?: number,
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
      '/api/v1/repair-orders/open',
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
    if (response.ok) {
      if (!validator(payload)) {
        throw new RepairOrderError('invalid_response', 'Public repair API returned invalid data');
      }
      return payload;
    }

    const message =
      isObject(payload) && typeof payload.message === 'string'
        ? payload.message
        : `Public repair API request failed with status ${response.status}`;

    if (response.status === 400 || response.status === 409 || response.status === 422) {
      throw new RepairOrderError('invalid_request', message, response.status);
    }
    if (response.status === 429) {
      throw new RepairOrderError('rate_limited', message, response.status);
    }
    if (response.status === 503) {
      throw new RepairOrderError('maintenance', message, response.status);
    }
    throw new RepairOrderError('unavailable', message, response.status);
  }
}
