import type { Knex } from 'knex';

import type {
  CrmRepairOrderStatus,
  RepairOrderStatusList,
  RepairOrderStatusNameRecord,
  RepairOrderStatusNameUpdate,
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
  listStatuses(): Promise<RepairOrderStatusList>;
}

export interface RepairOrderStatusNameStore {
  upsertFromCrm(statuses: CrmRepairOrderStatus[]): Promise<void>;
  listStatuses(): Promise<RepairOrderStatusNameRecord[]>;
  findById(id: string): Promise<RepairOrderStatusNameRecord | null>;
  updateDisplayNames(
    id: string,
    update: Partial<RepairOrderStatusNameUpdate>,
  ): Promise<RepairOrderStatusNameRecord | null>;
  findDisplayNamesByStatusIds(
    statusIds: string[],
  ): Promise<Map<string, RepairOrderStatusNameUpdate>>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

const isCrmRepairOrderStatus = (value: unknown): value is CrmRepairOrderStatus => {
  if (!isRecord(value)) return false;
  return (
    isUuid(value.id) &&
    typeof value.name_uz === 'string' &&
    typeof value.name_ru === 'string' &&
    typeof value.name_en === 'string'
  );
};

const isCrmRepairOrderStatusList = (value: unknown): value is CrmRepairOrderStatus[] => {
  return Array.isArray(value) && value.every(isCrmRepairOrderStatus);
};

const normalizeRepairOrderStatusList = (value: unknown): RepairOrderStatusList => {
  return {
    statuses: value as CrmRepairOrderStatus[],
  };
};

export class HttpRepairOrderStatusService implements RepairOrderStatusGateway {
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

  listStatuses(): Promise<RepairOrderStatusList> {
    return this.request('/api/v1/external/repair-order-statuses');
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
      body: isCrmRepairOrderStatusList(payload)
        ? {
            type: 'repair_order_status_list',
            count: normalizeRepairOrderStatusList(payload).statuses.length,
          }
        : summarizeUnknownPayload(payload),
    });

    if (response.ok) {
      if (!isCrmRepairOrderStatusList(payload)) {
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
  crm_sort_order: Number(row.crm_sort_order),
  crm_name_uz: row.crm_name_uz,
  crm_name_ru: row.crm_name_ru,
  crm_name_en: row.crm_name_en,
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
        statuses.map((status, index) => ({
          crm_status_id: status.id,
          crm_sort_order: index,
          crm_name_uz: status.name_uz,
          crm_name_ru: status.name_ru,
          crm_name_en: status.name_en,
        })),
      )
      .onConflict('crm_status_id')
      .merge({
        crm_sort_order: this.database.raw('excluded.crm_sort_order'),
        crm_name_uz: this.database.raw('excluded.crm_name_uz'),
        crm_name_ru: this.database.raw('excluded.crm_name_ru'),
        crm_name_en: this.database.raw('excluded.crm_name_en'),
        updated_at: this.database.fn.now(),
      });
  }

  async listStatuses(): Promise<RepairOrderStatusNameRecord[]> {
    const rows = (await this.database('repair_order_status_names')
      .select('*')
      .orderBy('crm_sort_order', 'asc')
      .orderBy('id', 'asc')) as StatusNameRow[];
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

  async findDisplayNamesByStatusIds(
    statusIds: string[],
  ): Promise<Map<string, RepairOrderStatusNameUpdate>> {
    const uniqueIds = [
      ...new Set(
        statusIds
          .map((statusId) => statusId.trim())
          .filter((statusId) => statusId.length > 0 && isUuid(statusId)),
      ),
    ];
    if (uniqueIds.length === 0) return new Map();

    const rows = (await this.database('repair_order_status_names')
      .select('crm_status_id', 'display_name_uz', 'display_name_ru')
      .whereIn('crm_status_id', uniqueIds)) as Pick<
      RepairOrderStatusNameRecord,
      'crm_status_id' | 'display_name_uz' | 'display_name_ru'
    >[];

    const result = new Map<string, RepairOrderStatusNameUpdate>();
    rows.forEach((row) => {
      result.set(row.crm_status_id, {
        display_name_uz: row.display_name_uz,
        display_name_ru: row.display_name_ru,
      });
    });
    return result;
  }
}
