import type { FastifyInstance } from 'fastify';
import type {
  DirectMessageInlineKeyboard,
  DirectMessageActionButton,
  DirectMessageInlineButton,
} from '../services/bot-notification.service.js';

import type {
  EmployeeNotificationService,
  EmployeeNotificationStore,
} from '../services/employee-notification.service.js';
import type {
  EmployeeNotificationTemplate,
  EmployeeNotificationType,
} from '../types/employee-notification.js';
import { isAuthorized } from './auth.js';
import { parseSendMessageBody } from './validators.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const isNotificationKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(value);
const isAccountId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 255;

const CONTENT_FIELDS = {
  message: 'message',
  localized_messages: 'localizedMessages',
  variables: 'variables',
  localized_variables: 'localizedVariables',
  parse_mode: 'parseMode',
  inline_keyboard: 'inlineKeyboard',
  type: 'type',
  repair_order_uuid: 'repairOrderUuid',
  order_number: 'orderNumber',
  attachments: 'attachments',
} as const;

export const parseNotificationContent = (
  body: unknown,
  partial = false,
): { ok: true; content: EmployeeNotificationTemplate } | { ok: false; message: string } => {
  if (!isRecord(body)) return { ok: false, message: 'message_template must be a JSON object' };
  for (const key of Object.keys(body)) {
    if (!Object.hasOwn(CONTENT_FIELDS, key))
      return { ok: false, message: `Unsupported message field: ${key}` };
  }
  const parsed = parseSendMessageBody({
    ...body,
    crm_client_id: 'notification-validation',
    ...(partial && body.message === undefined && body.localized_messages === undefined
      ? { message: 'validation' }
      : {}),
  });
  if (!parsed.ok) return parsed;
  const content: Record<string, unknown> = {};
  for (const [wireKey, field] of Object.entries(CONTENT_FIELDS)) {
    if (Object.hasOwn(body, wireKey)) content[field] = parsed[field];
  }
  return { ok: true, content: content as EmployeeNotificationTemplate };
};

const serializeButton = (
  button: DirectMessageActionButton | DirectMessageInlineButton,
): Record<string, unknown> => ({
  type: button.type,
  ...(button.text !== undefined ? { text: button.text } : {}),
  ...(button.localizedText ? { localized_text: button.localizedText } : {}),
  ...(button.style ? { style: button.style } : {}),
  ...('url' in button ? { url: button.url } : {}),
  ...('repairOrderUuid' in button ? { repair_order_uuid: button.repairOrderUuid } : {}),
});

const serializeKeyboard = (keyboard: DirectMessageInlineKeyboard): Record<string, unknown> => {
  if ('rows' in keyboard) return { rows: keyboard.rows.map((row) => row.map(serializeButton)) };
  return {
    ...serializeButton(keyboard),
    ...(keyboard.layout ? { layout: keyboard.layout.map((row) => row.map(serializeButton)) } : {}),
  };
};

const serializeType = (type: EmployeeNotificationType): Record<string, unknown> => ({
  ...type,
  message_template: Object.fromEntries(
    Object.entries(CONTENT_FIELDS)
      .filter(([, field]) => type.message_template[field] !== undefined)
      .map(([wire, field]) => {
        if (field === 'inlineKeyboard' && type.message_template.inlineKeyboard) {
          return [wire, serializeKeyboard(type.message_template.inlineKeyboard)];
        }
        if (field === 'attachments' && type.message_template.attachments) {
          return [
            wire,
            type.message_template.attachments.map(({ fileName, ...attachment }) => ({
              ...attachment,
              ...(fileName ? { file_name: fileName } : {}),
            })),
          ];
        }
        return [wire, type.message_template[field]];
      }),
  ),
});

export const registerEmployeeNotificationApi = (
  app: FastifyInstance,
  token: string,
  dependencies: {
    store?: EmployeeNotificationStore;
    service?: Pick<EmployeeNotificationService, 'send'>;
  },
): void => {
  app.register(
    async (routes) => {
      routes.addHook('onRequest', async (request, reply) => {
        if (!isAuthorized(request.headers.authorization, token)) {
          return reply.status(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'A valid Bearer token is required',
          });
        }
        if (!dependencies.store) {
          return reply.status(503).send({
            statusCode: 503,
            error: 'ServiceUnavailable',
            message: 'Employee notification storage is not available',
          });
        }
      });
      routes.get('/types', async () => ({
        data: (await dependencies.store!.listTypes()).map(serializeType),
      }));
      routes.put<{ Params: { key: string } }>('/types/:key', async (request, reply) => {
        const body = request.body;
        if (
          !isNotificationKey(request.params.key) ||
          !isRecord(body) ||
          typeof body.name_uz !== 'string' ||
          !body.name_uz.trim() ||
          body.name_uz.length > 120 ||
          typeof body.name_ru !== 'string' ||
          !body.name_ru.trim() ||
          body.name_ru.length > 120 ||
          typeof body.is_active !== 'boolean' ||
          typeof body.default_enabled !== 'boolean'
        ) {
          return reply.status(400).send({
            error: 'BadRequest',
            message: 'A valid key, localized names, is_active and default_enabled are required',
          });
        }
        const parsed = parseNotificationContent(body.message_template);
        if (!parsed.ok)
          return reply.status(400).send({ error: 'BadRequest', message: parsed.message });
        const type = await dependencies.store!.saveType({
          key: request.params.key,
          name_uz: body.name_uz.trim(),
          name_ru: body.name_ru.trim(),
          is_active: body.is_active,
          default_enabled: body.default_enabled,
          message_template: parsed.content,
        });
        return { data: serializeType(type) };
      });
      routes.get<{ Params: { crmAdminId: string } }>(
        '/employees/:crmAdminId/preferences',
        async (request, reply) => {
          const id = request.params.crmAdminId;
          if (!isAccountId(id))
            return reply
              .status(400)
              .send({ error: 'BadRequest', message: 'Invalid CRM employee ID' });
          return {
            data: (await dependencies.store!.listPreferences(id.trim())).map(
              ({ type, enabled }) => ({
                type_key: type.key,
                name_uz: type.name_uz,
                name_ru: type.name_ru,
                is_active: type.is_active,
                enabled,
              }),
            ),
          };
        },
      );
      routes.put<{ Params: { crmAdminId: string; key: string } }>(
        '/employees/:crmAdminId/preferences/:key',
        async (request, reply) => {
          const { crmAdminId, key } = request.params;
          if (
            !isAccountId(crmAdminId) ||
            !isNotificationKey(key) ||
            !isRecord(request.body) ||
            typeof request.body.enabled !== 'boolean'
          ) {
            return reply.status(400).send({
              error: 'BadRequest',
              message: 'Valid employee ID, type key and boolean enabled are required',
            });
          }
          if (!(await dependencies.store!.findType(key)))
            return reply
              .status(404)
              .send({ error: 'NotFound', message: 'Notification type not found' });
          // CRM may set preferences before the account links Telegram.
          await dependencies.store!.setPreference(crmAdminId.trim(), key, request.body.enabled);
          return { type_key: key, enabled: request.body.enabled };
        },
      );
      routes.post('/send', async (request, reply) => {
        if (!dependencies.service)
          return reply.status(503).send({
            error: 'ServiceUnavailable',
            message: 'Telegram notification delivery is not available',
          });
        const body = request.body;
        if (
          !isRecord(body) ||
          !isNotificationKey(body.type_key) ||
          !Array.isArray(body.crm_admin_ids) ||
          body.crm_admin_ids.length < 1 ||
          body.crm_admin_ids.length > 100 ||
          !body.crm_admin_ids.every(isAccountId)
        ) {
          return reply.status(400).send({
            error: 'BadRequest',
            message: 'type_key and 1 to 100 CRM employee IDs are required',
          });
        }
        const parsed = parseNotificationContent(
          body.content === undefined ? {} : body.content,
          true,
        );
        if (!parsed.ok)
          return reply.status(400).send({ error: 'BadRequest', message: parsed.message });
        const result = await dependencies.service.send({
          typeKey: body.type_key,
          crmAdminIds: [...new Set((body.crm_admin_ids as string[]).map((id) => id.trim()))],
          content: parsed.content,
        });
        if (result.status === 'type_not_found')
          return reply
            .status(404)
            .send({ error: 'NotFound', message: 'Notification type not found' });
        return result;
      });
    },
    { prefix: '/employee-notifications' },
  );
};
