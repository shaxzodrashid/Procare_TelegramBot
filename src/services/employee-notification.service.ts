import type { Knex } from 'knex';

import type {
  EmployeeNotificationPreference,
  EmployeeNotificationTemplate,
  EmployeeNotificationType,
} from '../types/employee-notification.js';
import type { RegisteredUserMessageTarget } from '../types/registered-user.js';
import type {
  BotDirectMessageService,
  DirectMessageDeliveryResult,
} from './bot-notification.service.js';
import type { RegisteredUserStore } from './registered-user.store.js';
import type { Logger } from '../utils/logger.js';

export interface EmployeeNotificationStore {
  listTypes(): Promise<EmployeeNotificationType[]>;
  findType(key: string): Promise<EmployeeNotificationType | null>;
  saveType(type: EmployeeNotificationType): Promise<EmployeeNotificationType>;
  listPreferences(crmAdminId: string): Promise<EmployeeNotificationPreference[]>;
  setPreference(crmAdminId: string, key: string, enabled: boolean): Promise<void>;
}

const TYPE_COLUMNS = [
  'key',
  'name_uz',
  'name_ru',
  'is_active',
  'default_enabled',
  'message_template',
];

export class PostgresEmployeeNotificationStore implements EmployeeNotificationStore {
  constructor(private readonly database: Knex) {}

  async listTypes(): Promise<EmployeeNotificationType[]> {
    return (await this.database('employee_notification_types')
      .select(TYPE_COLUMNS)
      .orderBy('key')) as EmployeeNotificationType[];
  }

  async findType(key: string): Promise<EmployeeNotificationType | null> {
    return (
      ((await this.database('employee_notification_types')
        .select(TYPE_COLUMNS)
        .where({ key })
        .first()) as EmployeeNotificationType | undefined) ?? null
    );
  }

  async saveType(type: EmployeeNotificationType): Promise<EmployeeNotificationType> {
    const rows = (await this.database('employee_notification_types')
      .insert(type)
      .onConflict('key')
      .merge({ ...type, updated_at: this.database.fn.now() })
      .returning(TYPE_COLUMNS)) as EmployeeNotificationType[];
    const row = rows[0];
    if (!row) throw new Error('Notification type upsert did not return a row');
    return row;
  }

  async listPreferences(crmAdminId: string): Promise<EmployeeNotificationPreference[]> {
    const [types, preferences] = await Promise.all([
      this.listTypes(),
      this.database<{ type_key: string; enabled: boolean }>('employee_notification_preferences')
        .select('type_key', 'enabled')
        .where({ crm_admin_id: crmAdminId }),
    ]);
    const overrides = new Map(preferences.map((row) => [row.type_key, row.enabled]));
    return types.map((type) => ({
      type,
      enabled: overrides.get(type.key) ?? type.default_enabled,
    }));
  }

  async setPreference(crmAdminId: string, key: string, enabled: boolean): Promise<void> {
    await this.database('employee_notification_preferences')
      .insert({ crm_admin_id: crmAdminId, type_key: key, enabled })
      .onConflict(['crm_admin_id', 'type_key'])
      .merge({ enabled, updated_at: this.database.fn.now() });
  }
}

export interface SendEmployeeNotificationParams {
  typeKey: string;
  crmAdminIds: string[];
  content?: EmployeeNotificationTemplate;
}

export interface EmployeeNotificationResult {
  crm_admin_id: string;
  telegram_id?: string;
  status: DirectMessageDeliveryResult['status'] | 'disabled' | 'type_inactive';
}

export class EmployeeNotificationService {
  constructor(
    private readonly store: EmployeeNotificationStore,
    private readonly users: Pick<
      RegisteredUserStore,
      'findActiveEmployeesByCrmAdminIds' | 'findByTelegramId'
    >,
    private readonly delivery: Pick<BotDirectMessageService, 'sendToRecipient'>,
    private readonly logger: Logger,
  ) {}

  async send(params: SendEmployeeNotificationParams): Promise<{
    status: 'processed' | 'type_not_found';
    results: EmployeeNotificationResult[];
  }> {
    const type = await this.store.findType(params.typeKey);
    if (!type) return { status: 'type_not_found', results: [] };
    const results: EmployeeNotificationResult[] = [];
    const targets = await this.users.findActiveEmployeesByCrmAdminIds(params.crmAdminIds);
    for (const crmAdminId of new Set(params.crmAdminIds)) {
      if (!type.is_active) {
        results.push({ crm_admin_id: crmAdminId, status: 'type_inactive' });
        continue;
      }
      const preference = (await this.store.listPreferences(crmAdminId)).find(
        (item) => item.type.key === type.key,
      );
      if (!(preference?.enabled ?? type.default_enabled)) {
        results.push({ crm_admin_id: crmAdminId, status: 'disabled' });
        continue;
      }
      const accountTargets = targets.filter((target) => target.crm_admin_id === crmAdminId);
      if (!accountTargets.length) {
        results.push({ crm_admin_id: crmAdminId, status: 'not_found' });
        continue;
      }
      for (const target of accountTargets) {
        const result: EmployeeNotificationResult = {
          crm_admin_id: crmAdminId,
          telegram_id: target.telegram_id,
          status: 'not_found',
        };
        try {
          const state = await this.users.findByTelegramId(target.telegram_id);
          if (state?.employee?.is_active && state.employee.crm_admin_id === crmAdminId) {
            const recipient: RegisteredUserMessageTarget = {
              ...state.user,
              id: target.id,
              is_blocked: target.is_blocked,
            };
            result.status = (
              await this.delivery.sendToRecipient(
                recipient,
                {
                  ...type.message_template,
                  ...params.content,
                  ...(params.content?.message !== undefined && !params.content.localizedMessages
                    ? { localizedMessages: undefined }
                    : {}),
                  ...(params.content?.message !== undefined || params.content?.localizedMessages
                    ? { type: params.content.type }
                    : {}),
                  variables: { ...type.message_template.variables, ...params.content?.variables },
                  localizedVariables: {
                    ...type.message_template.localizedVariables,
                    ...params.content?.localizedVariables,
                  },
                },
                `employee:${type.key}`,
              )
            ).status;
          }
        } catch (error) {
          result.status = 'failed';
          this.logger.error('Employee notification delivery failed', error);
        }
        results.push(result);
      }
    }
    return { status: 'processed', results };
  }
}
