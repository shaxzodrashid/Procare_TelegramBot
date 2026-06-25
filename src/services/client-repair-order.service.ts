import {
  CUSTOMER_SUPPORT_PHOTO_MIME_TYPES,
  CUSTOMER_REPAIR_STATUS_CODES,
  type CustomerAssignedAdmin,
  type CustomerAssignedAdminRole,
  type CustomerRepairBranch,
  type CustomerRepairDocuments,
  type CustomerSupportCommentRequest,
  type CustomerSupportCommentResponse,
  type CustomerSupportPhotoUpload,
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
import {
  redactPhoneNumbersInText,
  summarizeText,
  summarizeUnknownPayload,
} from '../utils/log-redaction.js';
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
  registerClientSupportComment(
    repairOrderId: string,
    request: CustomerSupportCommentRequest,
  ): Promise<CustomerSupportCommentResponse>;
}

interface ErrorEnvelope {
  message?: string;
}

const PAYMENT_STATUSES = new Set<PaymentStatus>(['unpaid', 'partial', 'paid', 'overpaid']);
const STATUS_CODES = new Set<string>(CUSTOMER_REPAIR_STATUS_CODES);
const ASSIGNED_ADMIN_ROLE_TYPES = new Set<string>([
  'SuperAdmin',
  'Operator',
  'Specialist',
  'Master',
  'Courier',
]);
const SUPPORT_PHOTO_MIME_TYPES = new Set<string>(CUSTOMER_SUPPORT_PHOTO_MIME_TYPES);
const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isIsoUtcTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && value.endsWith('Z') && Number.isFinite(Date.parse(value));

const isNullableIsoUtcTimestamp = (value: unknown): value is string | null =>
  value === null || isIsoUtcTimestamp(value);

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

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

const isOptionalLocalizedSummary = (
  value: unknown,
): value is LocalizedCustomerSummary | undefined =>
  value === undefined || isLocalizedSummary(value);

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

const isDocuments = (value: unknown): value is CustomerRepairDocuments =>
  isRecord(value) &&
  isNullableString(value.checklist_url) &&
  isNullableString(value.warranty_document_url) &&
  isNullableString(value.offer_url);

const isStatusHistoryItem = (value: unknown): value is CustomerRepairStatusHistoryItem =>
  isRecord(value) &&
  isLocalizedText(value) &&
  typeof value.code === 'string' &&
  value.code.length > 0 &&
  typeof value.progress_type === 'string' &&
  value.progress_type.length > 0 &&
  (value.step === null ||
    (typeof value.step === 'number' && Number.isInteger(value.step) && value.step >= 1)) &&
  (value.total_steps === null ||
    (typeof value.total_steps === 'number' &&
      Number.isInteger(value.total_steps) &&
      value.total_steps >= 1)) &&
  (typeof value.step !== 'number' ||
    typeof value.total_steps !== 'number' ||
    value.total_steps >= value.step) &&
  isIsoUtcTimestamp(value.changed_at);

const isAssignedAdminRole = (value: unknown): value is CustomerAssignedAdminRole =>
  isRecord(value) &&
  isUuid(value.id) &&
  typeof value.name === 'string' &&
  value.name.length > 0 &&
  (value.type === null || ASSIGNED_ADMIN_ROLE_TYPES.has(String(value.type)));

const isAssignedAdmin = (value: unknown): value is CustomerAssignedAdmin =>
  isRecord(value) &&
  isUuid(value.id) &&
  isNullableString(value.first_name) &&
  isNullableString(value.last_name) &&
  isNullableString(value.phone_number) &&
  Array.isArray(value.roles) &&
  value.roles.every(isAssignedAdminRole);

const isCustomerRepairOrderDetail = (value: unknown): value is CustomerRepairOrderDetail => {
  if (!isRecord(value) || !isListItem(value)) return false;
  return (
    isUuid(value.id) &&
    isIsoUtcTimestamp(value.updated_at) &&
    Array.isArray(value.assigned_admins) &&
    value.assigned_admins.every(isAssignedAdmin) &&
    isRecord(value.device) &&
    isNullableString(value.device.imei_last4) &&
    isCustomerStatus(value.status, true) &&
    isOptionalLocalizedSummary(value.problem_summary) &&
    isOptionalLocalizedSummary(value.service_summary) &&
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
    isDocuments(value.documents) &&
    Array.isArray(value.status_history) &&
    value.status_history.every(isStatusHistoryItem)
  );
};

const isSupportPhotoUrlSet = (
  value: unknown,
): value is CustomerSupportCommentResponse['comment']['photos'][number]['urls'] =>
  isRecord(value) &&
  typeof value.small === 'string' &&
  typeof value.medium === 'string' &&
  typeof value.large === 'string';

const isSupportCommentPhoto = (
  value: unknown,
): value is CustomerSupportCommentResponse['comment']['photos'][number] =>
  isRecord(value) &&
  isUuid(value.id) &&
  typeof value.original_name === 'string' &&
  typeof value.mime_type === 'string' &&
  isSupportPhotoUrlSet(value.urls);

const isSupportCommentAuthor = (
  value: unknown,
): value is CustomerSupportCommentResponse['comment']['author'] =>
  isRecord(value) &&
  isUuid(value.id) &&
  isNullableString(value.display_name) &&
  (value.phone_number === undefined || isNullableString(value.phone_number)) &&
  (value.username === undefined || isNullableString(value.username));

const isSupportCommentResponse = (value: unknown): value is CustomerSupportCommentResponse =>
  isRecord(value) &&
  typeof value.created === 'boolean' &&
  isRecord(value.comment) &&
  value.comment.item_type === 'message' &&
  isUuid(value.comment.id) &&
  value.comment.comment_type === 'support' &&
  value.comment.author_type === 'user' &&
  value.comment.direction === 'inbound' &&
  isNullableString(value.comment.text) &&
  isSupportCommentAuthor(value.comment.author) &&
  (value.comment.reply === null || isRecord(value.comment.reply)) &&
  Array.isArray(value.comment.photos) &&
  value.comment.photos.every(isSupportCommentPhoto) &&
  typeof value.comment.is_editable === 'boolean' &&
  typeof value.comment.is_deletable === 'boolean' &&
  typeof value.comment.is_edited === 'boolean' &&
  typeof value.comment.is_read === 'boolean' &&
  isIsoUtcTimestamp(value.comment.created_at) &&
  isIsoUtcTimestamp(value.comment.updated_at);

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
      repair_order_id: payload.id,
      order_number: payload.order_number,
      assigned_admins_count: payload.assigned_admins.length,
      status_code: payload.status.code,
      status_history_count: payload.status_history.length,
      payments_count: payload.pricing.payments.length,
    };
  }
  if (isSupportCommentResponse(payload)) {
    return {
      type: 'support_comment',
      comment_id: payload.comment.id,
      created: payload.created,
      photos_count: payload.comment.photos.length,
      text: summarizeText(payload.comment.text ?? ''),
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

  async registerClientSupportComment(
    repairOrderId: string,
    request: CustomerSupportCommentRequest,
  ): Promise<CustomerSupportCommentResponse> {
    if (!isUuid(repairOrderId)) {
      throw new ClientRepairOrderError('invalid_request', 'repairOrderId must be a UUID');
    }

    const text = request.text?.trim();
    const photos = request.photos ?? [];
    if (!text && photos.length === 0) {
      throw new ClientRepairOrderError('invalid_request', 'text or at least one photo is required');
    }
    if (text && text.length > 4_000) {
      throw new ClientRepairOrderError('invalid_request', 'support comment text is too long');
    }
    if (photos.length > 5) {
      throw new ClientRepairOrderError('invalid_request', 'a maximum of 5 photos is allowed');
    }
    if (photos.some((photo) => !SUPPORT_PHOTO_MIME_TYPES.has(photo.mimeType))) {
      throw new ClientRepairOrderError(
        'invalid_request',
        'only JPEG, PNG, and WebP photos are allowed',
      );
    }
    if (Boolean(request.replyTargetType) !== Boolean(request.replyTargetId)) {
      throw new ClientRepairOrderError(
        'invalid_request',
        'replyTargetType and replyTargetId must be provided together',
      );
    }

    const form = new FormData();
    if (text) form.append('text', text);
    if (request.replyTargetType && request.replyTargetId) {
      form.append('reply_target_type', request.replyTargetType);
      form.append('reply_target_id', request.replyTargetId);
    }
    photos.forEach((photo) => appendSupportPhoto(form, photo));

    return this.postMultipart(
      `/api/v1/repair-orders/register-comment/${encodeURIComponent(repairOrderId)}`,
      form,
      isSupportCommentResponse,
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

  private async postMultipart<T>(
    path: string,
    body: FormData,
    validator: (value: unknown) => value is T,
  ): Promise<T> {
    const authorization = Buffer.from(
      `${this.options.username}:${this.options.password}`,
      'utf8',
    ).toString('base64');
    this.logger.extra('Client repair-order API request', {
      method: 'POST',
      path,
      timeoutMs: this.options.timeoutMs,
    });

    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)(`${this.options.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Basic ${authorization}`,
        },
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      this.logger.error(`Client repair-order API network request failed for ${path}`, error);
      throw new ClientRepairOrderError('unavailable', 'Client repair-order API is unavailable');
    }

    const payload = (await response.json().catch(() => null)) as ErrorEnvelope | T | null;
    this.logger.extra('Client repair-order API response', {
      method: 'POST',
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

const appendSupportPhoto = (form: FormData, photo: CustomerSupportPhotoUpload): void => {
  const bytes = new Uint8Array(photo.data);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: photo.mimeType });
  form.append('photos', blob, photo.fileName);
};
