import {
  CUSTOMER_REPAIR_STATUS_CODES,
  type CustomerRepairBranch,
  type CustomerRepairOrderDetail,
  type CustomerRepairOrderList,
  type CustomerRepairOrderListItem,
  type CustomerRepairPayment,
  type CustomerRepairPricingDetail,
  type CustomerRepairStatus,
  type CustomerRepairStatusHistoryItem,
  type LocalizedCustomerText,
  type LocalizedCustomerSummary,
  type PaymentStatus,
} from '../types/client-repair-order.js';
import { redactPhoneNumbersInText, summarizeUnknownPayload } from '../utils/log-redaction.js';
import type { Logger } from '../utils/logger.js';

export type ClientRepairOrderFailureCode =
  | 'invalid_request'
  | 'not_found'
  | 'unauthorized'
  | 'maintenance'
  | 'unavailable'
  | 'invalid_response';

export class ClientRepairOrderError extends Error {
  constructor(
    public readonly code: ClientRepairOrderFailureCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ClientRepairOrderError';
  }
}

export interface ClientRepairOrderGateway {
  listClientRepairOrders(
    clientId: string,
    pagination?: { limit?: number; offset?: number },
  ): Promise<CustomerRepairOrderList>;
  getClientRepairOrder(clientId: string, orderNumber: string): Promise<CustomerRepairOrderDetail>;
}

interface ErrorEnvelope {
  message?: string;
}

const PAYMENT_STATUSES = new Set<PaymentStatus>(['unpaid', 'partial', 'paid', 'overpaid']);
const STATUS_CODES = new Set<string>(CUSTOMER_REPAIR_STATUS_CODES);
const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isIsoUtcTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && value.endsWith('Z') && Number.isFinite(Date.parse(value));

const isNullableIsoUtcTimestamp = (value: unknown): value is string | null =>
  value === null || isIsoUtcTimestamp(value);

const isDecimalString = (value: unknown): value is string =>
  typeof value === 'string' && DECIMAL_PATTERN.test(value);

const isNullableDecimalString = (value: unknown): value is string | null =>
  value === null || isDecimalString(value);

const isLocalizedText = (value: unknown): value is LocalizedCustomerText =>
  isRecord(value) &&
  isNullableString(value.name_uz) &&
  isNullableString(value.name_ru) &&
  isNullableString(value.name_en);

const isLocalizedSummary = (value: unknown): value is LocalizedCustomerSummary =>
  isRecord(value) &&
  isNullableString(value.uz) &&
  isNullableString(value.ru) &&
  isNullableString(value.en);

const hasValidProgress = (value: Record<string, unknown>): boolean => {
  if (value.progress_type === 'terminal') {
    return value.step === null && value.total_steps === null;
  }
  return (
    value.progress_type === 'linear' &&
    typeof value.step === 'number' &&
    Number.isInteger(value.step) &&
    value.step >= 1 &&
    typeof value.total_steps === 'number' &&
    Number.isInteger(value.total_steps) &&
    value.total_steps >= value.step
  );
};

const isCustomerStatus = (
  value: unknown,
  requireMessages: boolean,
): value is CustomerRepairStatus => {
  const record = isRecord(value) ? value : null;
  if (
    !record ||
    !isLocalizedText(record) ||
    !STATUS_CODES.has(String(record.code)) ||
    !hasValidProgress(record) ||
    !isIsoUtcTimestamp(record.updated_at)
  ) {
    return false;
  }

  if (!requireMessages) return true;
  return (
    isNullableString(record.customer_message_uz) &&
    isNullableString(record.customer_message_ru) &&
    isNullableString(record.customer_message_en)
  );
};

const isListPricing = (value: unknown): value is CustomerRepairOrderListItem['pricing'] =>
  isRecord(value) &&
  typeof value.currency === 'string' &&
  value.currency.length > 0 &&
  isNullableDecimalString(value.final_total) &&
  PAYMENT_STATUSES.has(value.payment_status as PaymentStatus);

const isListItem = (value: unknown): value is CustomerRepairOrderListItem =>
  isRecord(value) &&
  typeof value.order_number === 'string' &&
  value.order_number.length > 0 &&
  isRecord(value.device) &&
  isNullableString(value.device.brand) &&
  isNullableString(value.device.model) &&
  isCustomerStatus(value.status, false) &&
  isIsoUtcTimestamp(value.created_at) &&
  isNullableIsoUtcTimestamp(value.estimated_ready_at) &&
  isListPricing(value.pricing);

const isCustomerRepairOrderList = (value: unknown): value is CustomerRepairOrderList =>
  isRecord(value) &&
  Array.isArray(value.orders) &&
  value.orders.every(isListItem) &&
  isRecord(value.pagination) &&
  typeof value.pagination.limit === 'number' &&
  Number.isInteger(value.pagination.limit) &&
  value.pagination.limit >= 1 &&
  value.pagination.limit <= 50 &&
  typeof value.pagination.offset === 'number' &&
  Number.isInteger(value.pagination.offset) &&
  value.pagination.offset >= 0 &&
  typeof value.pagination.total === 'number' &&
  Number.isInteger(value.pagination.total) &&
  value.pagination.total >= 0 &&
  typeof value.pagination.has_more === 'boolean';

const isPayment = (value: unknown): value is CustomerRepairPayment =>
  isRecord(value) &&
  isDecimalString(value.amount) &&
  typeof value.currency === 'string' &&
  value.currency.length > 0 &&
  isIsoUtcTimestamp(value.paid_at) &&
  typeof value.method === 'string';

const isDetailPricing = (value: unknown): value is CustomerRepairPricingDetail =>
  isRecord(value) &&
  isListPricing(value) &&
  isNullableDecimalString(value.estimated_total) &&
  isDecimalString(value.paid_amount) &&
  isDecimalString(value.remaining_amount) &&
  Array.isArray(value.payments) &&
  value.payments.every(isPayment);

const isBranch = (value: unknown): value is CustomerRepairBranch =>
  isRecord(value) &&
  isLocalizedText(value) &&
  isNullableString(value.address_uz) &&
  isNullableString(value.address_ru) &&
  isNullableString(value.address_en) &&
  isNullableString(value.telephone) &&
  isRecord(value.working_hours) &&
  isNullableString(value.working_hours.start) &&
  isNullableString(value.working_hours.end) &&
  isNullableString(value.map_url);

const isStatusHistoryItem = (value: unknown): value is CustomerRepairStatusHistoryItem =>
  isRecord(value) &&
  isLocalizedText(value) &&
  STATUS_CODES.has(String(value.code)) &&
  hasValidProgress(value) &&
  isIsoUtcTimestamp(value.changed_at);

const isCustomerRepairOrderDetail = (value: unknown): value is CustomerRepairOrderDetail => {
  if (!isRecord(value) || !isListItem(value)) return false;
  return (
    isIsoUtcTimestamp(value.updated_at) &&
    isRecord(value.device) &&
    isNullableString(value.device.imei_last4) &&
    isCustomerStatus(value.status, true) &&
    isLocalizedSummary(value.problem_summary) &&
    isLocalizedSummary(value.service_summary) &&
    isDetailPricing(value.pricing) &&
    isBranch(value.branch) &&
    isNullableIsoUtcTimestamp(value.completed_at) &&
    isNullableIsoUtcTimestamp(value.picked_up_at) &&
    isRecord(value.warranty) &&
    (value.warranty.period_months === null ||
      (typeof value.warranty.period_months === 'number' &&
        Number.isInteger(value.warranty.period_months) &&
        value.warranty.period_months >= 0)) &&
    isNullableIsoUtcTimestamp(value.warranty.warranty_until) &&
    Array.isArray(value.status_history) &&
    value.status_history.every(isStatusHistoryItem)
  );
};

const summarizePayload = (payload: unknown): unknown => {
  if (isCustomerRepairOrderList(payload)) {
    return {
      type: 'repair_order_list',
      orders_count: payload.orders.length,
      order_numbers: payload.orders.map((order) => order.order_number),
      pagination: payload.pagination,
    };
  }
  if (isCustomerRepairOrderDetail(payload)) {
    return {
      type: 'repair_order_detail',
      order_number: payload.order_number,
      status_code: payload.status.code,
      status_history_count: payload.status_history.length,
      payments_count: payload.pricing.payments.length,
    };
  }
  if (isRecord(payload) && typeof payload.message === 'string') {
    return { message: redactPhoneNumbersInText(payload.message) };
  }
  return summarizeUnknownPayload(payload);
};

export class HttpClientRepairOrderService implements ClientRepairOrderGateway {
  constructor(
    private readonly options: {
      baseUrl: string;
      username: string;
      password: string;
      timeoutMs: number;
      maxRetries: number;
      fetchImpl?: typeof fetch;
      sleep?: (ms: number) => Promise<void>;
    },
    private readonly logger: Logger,
  ) {}

  listClientRepairOrders(
    clientId: string,
    pagination: { limit?: number; offset?: number } = {},
  ): Promise<CustomerRepairOrderList> {
    const limit = pagination.limit ?? 10;
    const offset = pagination.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new ClientRepairOrderError('invalid_request', 'limit must be an integer from 1 to 50');
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new ClientRepairOrderError('invalid_request', 'offset must be a non-negative integer');
    }

    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return this.request(
      `/api/v1/telegram/clients/${encodeURIComponent(clientId)}/repair-orders?${query}`,
      isCustomerRepairOrderList,
    );
  }

  getClientRepairOrder(clientId: string, orderNumber: string): Promise<CustomerRepairOrderDetail> {
    return this.request(
      `/api/v1/telegram/clients/${encodeURIComponent(clientId)}/repair-orders/${encodeURIComponent(orderNumber)}`,
      isCustomerRepairOrderDetail,
    );
  }

  private async request<T>(path: string, validator: (value: unknown) => value is T): Promise<T> {
    const attempts = this.options.maxRetries + 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.requestOnce(path, validator);
      } catch (error) {
        const retryable =
          error instanceof ClientRepairOrderError &&
          (error.code === 'maintenance' || error.code === 'unavailable');
        if (!retryable || attempt === attempts) throw error;

        const delayMs = 250 * 2 ** (attempt - 1);
        this.logger.warn(
          `Client repair-order API attempt ${attempt} failed; retrying in ${delayMs}ms`,
          { path, code: error.code, status: error.status },
        );
        await (this.options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(
          delayMs,
        );
      }
    }
    throw new ClientRepairOrderError('unavailable', 'Client repair-order API request failed');
  }

  private async requestOnce<T>(
    path: string,
    validator: (value: unknown) => value is T,
  ): Promise<T> {
    const authorization = Buffer.from(
      `${this.options.username}:${this.options.password}`,
      'utf8',
    ).toString('base64');
    this.logger.extra('Client repair-order API request', {
      method: 'GET',
      path,
      timeoutMs: this.options.timeoutMs,
    });

    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)(`${this.options.baseUrl}${path}`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Basic ${authorization}`,
        },
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      this.logger.error(`Client repair-order API network request failed for ${path}`, error);
      throw new ClientRepairOrderError('unavailable', 'Client repair-order API is unavailable');
    }

    const payload = (await response.json().catch(() => null)) as ErrorEnvelope | T | null;
    this.logger.extra('Client repair-order API response', {
      method: 'GET',
      path,
      status: response.status,
      ok: response.ok,
      body: summarizePayload(payload),
    });

    if (response.ok) {
      if (!validator(payload)) {
        throw new ClientRepairOrderError(
          'invalid_response',
          'Client repair-order API returned invalid data',
        );
      }
      return payload;
    }

    const message =
      isRecord(payload) && typeof payload.message === 'string'
        ? payload.message
        : `Client repair-order API request failed with status ${response.status}`;
    if (response.status === 400 || response.status === 422) {
      throw new ClientRepairOrderError('invalid_request', message, response.status);
    }
    if (response.status === 401) {
      throw new ClientRepairOrderError('unauthorized', message, response.status);
    }
    if (response.status === 404) {
      throw new ClientRepairOrderError('not_found', message, response.status);
    }
    if (response.status === 503) {
      throw new ClientRepairOrderError('maintenance', message, response.status);
    }
    throw new ClientRepairOrderError('unavailable', message, response.status);
  }
}
