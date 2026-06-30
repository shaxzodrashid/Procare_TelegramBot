import type { Knex } from 'knex';

import type {
  CrmRepairOrderStatus,
  RepairOrderStatusList,
  RepairOrderStatusNameRecord,
  RepairOrderStatusNameUpdate,
  RepairOrderStatusPermissions,
} from '../types/repair-order-status.js';
import { summarizeUnknownPayload } from '../utils/log-redaction.js';
import type { Logger } from '../utils/logger.js';

export type RepairOrderStatusFailureCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'maintenance'
  | 'unavailable'
  | 'invalid_response';

export class RepairOrderStatusError extends Error {
  constructor(
    public readonly code: RepairOrderStatusFailureCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'RepairOrderStatusError';
  }
}

export interface RepairOrderStatusGateway {
  listStatuses(pagination?: { limit?: number; offset?: number }): Promise<RepairOrderStatusList>;
}

export interface RepairOrderStatusNameStore {
  upsertFromCrm(statuses: CrmRepairOrderStatus[]): Promise<void>;
  listStatuses(): Promise<RepairOrderStatusNameRecord[]>;
  findById(id: string): Promise<RepairOrderStatusNameRecord | null>;
  updateDisplayNames(
    id: string,
    update: Partial<RepairOrderStatusNameUpdate>,
  ): Promise<RepairOrderStatusNameRecord | null>;
  findDisplayNamesByCustomerCodes(
    customerCodes: string[],
  ): Promise<Map<string, RepairOrderStatusNameUpdate>>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REQUIRED_PERMISSION_KEYS = [
  'can_add',
  'can_view',
  'can_update',
  'can_delete',
  'can_payment_add',
  'can_payment_cancel',
  'can_assign_admin',
  'can_notification',
  'can_notification_bot',
  'can_change_active',
  'can_change_status',
  'can_view_initial_problems',
  'can_change_initial_problems',
  'can_view_final_problems',
  'can_change_final_problems',
  'can_comment',
  'can_pickup_manage',
  'can_delivery_manage',
  'can_view_payments',
  'can_view_history',
  'cannot_continue_without_service_form',
  'cannot_continue_from_mother_branch',
  'cannot_continue_without_final_problems',
  'cannot_continue_without_final_problems_done',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isNullableInteger = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isInteger(value));

const isPermissions = (value: unknown): value is RepairOrderStatusPermissions =>
  isRecord(value) && REQUIRED_PERMISSION_KEYS.every((key) => typeof value[key] === 'boolean');

const hasValidCustomerProgress = (value: Record<string, unknown>): boolean => {
  if (value.customer_progress_type === null) {
    return value.customer_step === null && value.customer_total_steps === null;
  }
  if (value.customer_progress_type === 'terminal') {
    return value.customer_step === null && value.customer_total_steps === null;
  }
  return (
    value.customer_progress_type === 'linear' &&
    typeof value.customer_step === 'number' &&
    Number.isInteger(value.customer_step) &&
    value.customer_step >= 1 &&
    typeof value.customer_total_steps === 'number' &&
    Number.isInteger(value.customer_total_steps) &&
    value.customer_total_steps >= value.customer_step
  );
};

const isCrmRepairOrderStatus = (value: unknown): value is CrmRepairOrderStatus => {
  if (!isRecord(value)) return false;
  return (
    isUuid(value.id) &&
    typeof value.name_uz === 'string' &&
    typeof value.name_ru === 'string' &&
    typeof value.name_en === 'string' &&
    typeof value.bg_color === 'string' &&
    typeof value.color === 'string' &&
    typeof value.sort === 'number' &&
    Number.isInteger(value.sort) &&
    typeof value.can_user_view === 'boolean' &&
    typeof value.is_active === 'boolean' &&
    typeof value.type === 'string' &&
    typeof value.is_protected === 'boolean' &&
    typeof value.can_add_payment === 'boolean' &&
    typeof value.suppress_is_taken_from_mother === 'boolean' &&
    isNullableString(value.customer_code) &&
    (value.customer_progress_type === null ||
      value.customer_progress_type === 'linear' ||
      value.customer_progress_type === 'terminal') &&
    isNullableInteger(value.customer_step) &&
    isNullableInteger(value.customer_total_steps) &&
    hasValidCustomerProgress(value) &&
    isNullableString(value.customer_message_uz) &&
    isNullableString(value.customer_message_ru) &&
    isNullableString(value.customer_message_en) &&
    (value.status === 'Open' || value.status === 'Deleted') &&
    isUuid(value.branch_id) &&
    isNullableString(value.created_by) &&
    isIsoTimestamp(value.created_at) &&
    isIsoTimestamp(value.updated_at) &&
    isPermissions(value.permissions) &&
    Array.isArray(value.transitions) &&
    value.transitions.every(isUuid) &&
    isRecord(value.metrics) &&
    typeof value.metrics.total_repair_orders === 'number' &&
    Number.isInteger(value.metrics.total_repair_orders) &&
    value.metrics.total_repair_orders >= 0
  );
};

const isRepairOrderStatusList = (value: unknown): value is RepairOrderStatusList => {
  if (!isRecord(value)) return false;
  if (Array.isArray(value.data) && isRecord(value.meta)) {
    return (
      value.data.every(isCrmRepairOrderStatus) &&
      typeof value.meta.total === 'number' &&
      typeof value.meta.limit === 'number' &&
      typeof value.meta.offset === 'number'
    );
  }
  return (
    Array.isArray(value.rows) &&
    value.rows.every(isCrmRepairOrderStatus) &&
    typeof value.total === 'number' &&
    typeof value.limit === 'number' &&
    typeof value.offset === 'number'
  );
};

const normalizeRepairOrderStatusList = (value: unknown): RepairOrderStatusList => {
  if (!isRecord(value)) throw new Error('invalid response');
  if (Array.isArray(value.data) && isRecord(value.meta)) {
    return {
      statuses: value.data as CrmRepairOrderStatus[],
      pagination: {
        total: value.meta.total as number,
        limit: value.meta.limit as number,
        offset: value.meta.offset as number,
      },
    };
  }
  return {
    statuses: value.rows as CrmRepairOrderStatus[],
    pagination: {
      total: value.total as number,
      limit: value.limit as number,
      offset: value.offset as number,
    },
  };
};

export class HttpRepairOrderStatusService implements RepairOrderStatusGateway {
  constructor(
    private readonly options: {
      baseUrl: string;
      username: string;
      password: string;
      branchId: string;
      timeoutMs: number;
      maxRetries: number;
      fetchImpl?: typeof fetch;
      sleep?: (ms: number) => Promise<void>;
    },
    private readonly logger: Logger,
  ) {}

  listStatuses(
    pagination: { limit?: number; offset?: number } = {},
  ): Promise<RepairOrderStatusList> {
    const limit = pagination.limit ?? 50;
    const offset = pagination.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new RepairOrderStatusError('invalid_request', 'limit must be an integer from 1 to 200');
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new RepairOrderStatusError('invalid_request', 'offset must be a non-negative integer');
    }

    const query = new URLSearchParams({
      branch_id: this.options.branchId,
      limit: String(limit),
      offset: String(offset),
    });
    return this.request(`/api/v1/external/repair-order-statuses?${query}`);
  }

  private async request(path: string): Promise<RepairOrderStatusList> {
    const attempts = this.options.maxRetries + 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.requestOnce(path);
      } catch (error) {
        const retryable =
          error instanceof RepairOrderStatusError &&
          (error.code === 'maintenance' || error.code === 'unavailable');
        if (!retryable || attempt === attempts) throw error;

        const delayMs = 250 * 2 ** (attempt - 1);
        this.logger.warn(
          `Repair-order status API attempt ${attempt} failed; retrying in ${delayMs}ms`,
          { path, code: error.code, status: error.status },
        );
        await (this.options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(
          delayMs,
        );
      }
    }
    throw new RepairOrderStatusError('unavailable', 'Repair-order status API request failed');
  }

  private async requestOnce(path: string): Promise<RepairOrderStatusList> {
    const authorization = Buffer.from(
      `${this.options.username}:${this.options.password}`,
      'utf8',
    ).toString('base64');
    this.logger.extra('Repair-order status API request', {
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
      this.logger.error(`Repair-order status API network request failed for ${path}`, error);
      throw new RepairOrderStatusError('unavailable', 'Repair-order status API is unavailable');
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    this.logger.extra('Repair-order status API response', {
      method: 'GET',
      path,
      status: response.status,
      ok: response.ok,
      body: isRepairOrderStatusList(payload)
        ? {
            type: 'repair_order_status_list',
            count: normalizeRepairOrderStatusList(payload).statuses.length,
          }
        : summarizeUnknownPayload(payload),
    });

    if (response.ok) {
      if (!isRepairOrderStatusList(payload)) {
        throw new RepairOrderStatusError(
          'invalid_response',
          'Repair-order status API returned invalid data',
        );
      }
      return normalizeRepairOrderStatusList(payload);
    }

    const message =
      isRecord(payload) && typeof payload.message === 'string'
        ? payload.message
        : `Repair-order status API request failed with status ${response.status}`;
    if (response.status === 400 || response.status === 422) {
      throw new RepairOrderStatusError('invalid_request', message, response.status);
    }
    if (response.status === 401) {
      throw new RepairOrderStatusError('unauthorized', message, response.status);
    }
    if (response.status === 503) {
      throw new RepairOrderStatusError('maintenance', message, response.status);
    }
    throw new RepairOrderStatusError('unavailable', message, response.status);
  }
}

type StatusNameRow = RepairOrderStatusNameRecord;

const rowToStatusName = (row: StatusNameRow): RepairOrderStatusNameRecord => ({
  id: String(row.id),
  crm_status_id: row.crm_status_id,
  branch_id: row.branch_id,
  customer_code: row.customer_code,
  crm_name_uz: row.crm_name_uz,
  crm_name_ru: row.crm_name_ru,
  crm_name_en: row.crm_name_en,
  sort: Number(row.sort),
  can_user_view: Boolean(row.can_user_view),
  is_active: Boolean(row.is_active),
  customer_progress_type: row.customer_progress_type,
  total_repair_orders: Number(row.total_repair_orders),
  display_name_uz: row.display_name_uz,
  display_name_ru: row.display_name_ru,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export class PostgresRepairOrderStatusNameStore implements RepairOrderStatusNameStore {
  constructor(private readonly database: Knex) {}

  async upsertFromCrm(statuses: CrmRepairOrderStatus[]): Promise<void> {
    if (statuses.length === 0) return;
    await this.database('repair_order_status_names')
      .insert(
        statuses.map((status) => ({
          crm_status_id: status.id,
          branch_id: status.branch_id,
          customer_code: status.customer_code,
          crm_name_uz: status.name_uz,
          crm_name_ru: status.name_ru,
          crm_name_en: status.name_en,
          sort: status.sort,
          can_user_view: status.can_user_view,
          is_active: status.is_active,
          customer_progress_type: status.customer_progress_type,
          total_repair_orders: status.metrics.total_repair_orders,
        })),
      )
      .onConflict('crm_status_id')
      .merge({
        branch_id: this.database.raw('excluded.branch_id'),
        customer_code: this.database.raw('excluded.customer_code'),
        crm_name_uz: this.database.raw('excluded.crm_name_uz'),
        crm_name_ru: this.database.raw('excluded.crm_name_ru'),
        crm_name_en: this.database.raw('excluded.crm_name_en'),
        sort: this.database.raw('excluded.sort'),
        can_user_view: this.database.raw('excluded.can_user_view'),
        is_active: this.database.raw('excluded.is_active'),
        customer_progress_type: this.database.raw('excluded.customer_progress_type'),
        total_repair_orders: this.database.raw('excluded.total_repair_orders'),
        updated_at: this.database.fn.now(),
      });
  }

  async listStatuses(): Promise<RepairOrderStatusNameRecord[]> {
    const rows = (await this.database('repair_order_status_names')
      .select('*')
      .orderBy('sort', 'asc')
      .orderBy('crm_name_uz', 'asc')) as StatusNameRow[];
    return rows.map(rowToStatusName);
  }

  async findById(id: string): Promise<RepairOrderStatusNameRecord | null> {
    const row = (await this.database('repair_order_status_names').where({ id }).first()) as
      | StatusNameRow
      | undefined;
    return row ? rowToStatusName(row) : null;
  }

  async updateDisplayNames(
    id: string,
    update: Partial<RepairOrderStatusNameUpdate>,
  ): Promise<RepairOrderStatusNameRecord | null> {
    const rows = (await this.database('repair_order_status_names')
      .where({ id })
      .update({
        ...update,
        updated_at: this.database.fn.now(),
      })
      .returning('*')) as StatusNameRow[];
    const first = rows[0];
    return first ? rowToStatusName(first) : null;
  }

  async findDisplayNamesByCustomerCodes(
    customerCodes: string[],
  ): Promise<Map<string, RepairOrderStatusNameUpdate>> {
    const uniqueCodes = [...new Set(customerCodes.map((code) => code.trim()).filter(Boolean))];
    if (uniqueCodes.length === 0) return new Map();

    const rows = (await this.database('repair_order_status_names')
      .select('customer_code', 'display_name_uz', 'display_name_ru')
      .whereIn('customer_code', uniqueCodes)
      .andWhere('is_active', true)
      .andWhere('can_user_view', true)) as Pick<
      RepairOrderStatusNameRecord,
      'customer_code' | 'display_name_uz' | 'display_name_ru'
    >[];

    const result = new Map<string, RepairOrderStatusNameUpdate>();
    rows.forEach((row) => {
      if (!row.customer_code) return;
      result.set(row.customer_code, {
        display_name_uz: row.display_name_uz,
        display_name_ru: row.display_name_ru,
      });
    });
    return result;
  }
}
