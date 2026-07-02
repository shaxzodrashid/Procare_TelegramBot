import {
  TELEGRAM_TEXT_LIMIT,
  type DirectMessageInlineKeyboard,
  type DirectMessageSupportReply,
  type DirectMessageVariables,
} from '../services/bot-notification.service.js';
import { normalizeUzPhone } from '../utils/phone.js';
import { isMessageTemplateType, type MessageTemplateType } from '../types/message-template.js';

export interface SendMessageRequestBody {
  phone_number?: unknown;
  message?: unknown;
  variables?: unknown;
  inline_keyboard?: unknown;
  support_reply?: unknown;
  type?: unknown;
  crm_comment_id?: unknown;
  repair_order_uuid?: unknown;
  order_number?: unknown;
}

export interface SendFileRequestBody {
  phone_number?: unknown;
  file_type?: unknown;
  file_url?: unknown;
  file_name?: unknown;
  variables?: unknown;
  caption?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INLINE_KEYBOARD_ROWS = 8;
const MAX_INLINE_KEYBOARD_BUTTONS = 32;
const MAX_INLINE_KEYBOARD_BUTTONS_PER_ROW = 4;
const MAX_INLINE_KEYBOARD_TEXT_LENGTH = 64;

export const parseVariables = (
  value: unknown,
): { ok: true; variables: DirectMessageVariables } | { ok: false; message: string } => {
  if (value === undefined) return { ok: true, variables: {} };
  if (!isRecord(value)) return { ok: false, message: 'variables must be a JSON object' };

  const variables: DirectMessageVariables = {};
  for (const [key, rawVariable] of Object.entries(value)) {
    if (!/^[a-zA-Z0-9_]{1,64}$/.test(key)) {
      return {
        ok: false,
        message: 'variable names may contain only letters, numbers, and underscores',
      };
    }
    if (
      rawVariable !== null &&
      typeof rawVariable !== 'string' &&
      typeof rawVariable !== 'number' &&
      typeof rawVariable !== 'boolean'
    ) {
      return {
        ok: false,
        message: 'variable values must be strings, numbers, booleans, or null',
      };
    }
    variables[key] = rawVariable;
  }

  return { ok: true, variables };
};

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const parseKeyboardButton = (
  value: unknown,
):
  | { ok: true; button: DirectMessageInlineKeyboard['rows'][number][number] }
  | { ok: false; message: string } => {
  if (!isRecord(value)) return { ok: false, message: 'inline keyboard buttons must be objects' };

  const { type, text } = value;
  if (type !== 'url' && type !== 'repair_order') {
    return { ok: false, message: 'inline keyboard button type must be url or repair_order' };
  }

  if (text !== undefined) {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, message: 'inline keyboard button text must be a non-empty string' };
    }
    if (text.trim().length > MAX_INLINE_KEYBOARD_TEXT_LENGTH) {
      return {
        ok: false,
        message: `inline keyboard button text must be ${MAX_INLINE_KEYBOARD_TEXT_LENGTH} characters or fewer`,
      };
    }
  }

  if (type === 'url') {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, message: 'url buttons require text' };
    }
    if (typeof value.url !== 'string' || !isHttpUrl(value.url)) {
      return { ok: false, message: 'url buttons require an http or https url' };
    }
    return { ok: true, button: { type, text: text.trim(), url: value.url } };
  }

  if (typeof value.repair_order_uuid !== 'string' || !UUID_PATTERN.test(value.repair_order_uuid)) {
    return { ok: false, message: 'repair_order buttons require a valid repair_order_uuid' };
  }

  return {
    ok: true,
    button: {
      type,
      text: typeof text === 'string' ? text.trim() : undefined,
      repairOrderUuid: value.repair_order_uuid,
    },
  };
};

export const parseInlineKeyboard = (
  value: unknown,
): { ok: true; inlineKeyboard?: DirectMessageInlineKeyboard } | { ok: false; message: string } => {
  if (value === undefined) return { ok: true };
  if (!isRecord(value)) return { ok: false, message: 'inline_keyboard must be a JSON object' };

  if (value.type === 'repair_order') {
    const parsedButton = parseKeyboardButton(value);
    if (!parsedButton.ok) return parsedButton;
    return { ok: true, inlineKeyboard: { rows: [[parsedButton.button]] } };
  }

  if (!Array.isArray(value.rows)) {
    return { ok: false, message: 'inline_keyboard.rows must be an array' };
  }
  if (value.rows.length === 0 || value.rows.length > MAX_INLINE_KEYBOARD_ROWS) {
    return {
      ok: false,
      message: `inline_keyboard.rows must contain 1 to ${MAX_INLINE_KEYBOARD_ROWS} rows`,
    };
  }

  let buttonCount = 0;
  const rows: DirectMessageInlineKeyboard['rows'] = [];
  for (const rawRow of value.rows) {
    if (
      !Array.isArray(rawRow) ||
      rawRow.length === 0 ||
      rawRow.length > MAX_INLINE_KEYBOARD_BUTTONS_PER_ROW
    ) {
      return {
        ok: false,
        message: `each inline keyboard row must contain 1 to ${MAX_INLINE_KEYBOARD_BUTTONS_PER_ROW} buttons`,
      };
    }

    const row: DirectMessageInlineKeyboard['rows'][number] = [];
    for (const rawButton of rawRow) {
      buttonCount += 1;
      if (buttonCount > MAX_INLINE_KEYBOARD_BUTTONS) {
        return {
          ok: false,
          message: `inline keyboard must contain ${MAX_INLINE_KEYBOARD_BUTTONS} buttons or fewer`,
        };
      }

      const parsedButton = parseKeyboardButton(rawButton);
      if (!parsedButton.ok) return parsedButton;
      row.push(parsedButton.button);
    }
    rows.push(row);
  }

  return { ok: true, inlineKeyboard: { rows } };
};

export const parseSupportReply = (
  value: unknown,
): { ok: true; supportReply?: DirectMessageSupportReply } | { ok: false; message: string } => {
  if (value === undefined) return { ok: true };
  if (!isRecord(value)) return { ok: false, message: 'support_reply must be a JSON object' };

  if (
    typeof value.target_crm_comment_id !== 'string' ||
    !UUID_PATTERN.test(value.target_crm_comment_id)
  ) {
    return {
      ok: false,
      message: 'support_reply.target_crm_comment_id must be a valid CRM comment UUID',
    };
  }

  return {
    ok: true,
    supportReply: { targetCrmCommentId: value.target_crm_comment_id },
  };
};

export const parseSendMessageBody = (
  body: unknown,
):
  | {
      ok: true;
      phoneNumber: string;
      message: string;
      variables: DirectMessageVariables;
      inlineKeyboard?: DirectMessageInlineKeyboard;
      supportReply?: DirectMessageSupportReply;
      type?: MessageTemplateType;
      crmCommentId?: string;
      repairOrderUuid?: string;
      orderNumber?: string;
    }
  | { ok: false; message: string } => {
  if (!isRecord(body)) return { ok: false, message: 'Request body must be a JSON object' };

  const {
    phone_number: rawPhoneNumber,
    message: rawMessage,
    variables: rawVariables,
    inline_keyboard: rawInlineKeyboard,
    support_reply: rawSupportReply,
    type: rawType,
    crm_comment_id: rawCrmCommentId,
    repair_order_uuid: rawRepairOrderUuid,
    order_number: rawOrderNumber,
  } = body as SendMessageRequestBody;
  if (typeof rawPhoneNumber !== 'string') {
    return { ok: false, message: 'phone_number must be a string' };
  }
  if (typeof rawMessage !== 'string') return { ok: false, message: 'message must be a string' };

  const phoneNumber = normalizeUzPhone(rawPhoneNumber);
  if (!phoneNumber)
    return { ok: false, message: 'phone_number must be a valid Uzbek phone number' };

  const message = rawMessage.trim();
  if (!message) return { ok: false, message: 'message must not be empty' };
  if (message.length > TELEGRAM_TEXT_LIMIT) {
    return { ok: false, message: `message must be ${TELEGRAM_TEXT_LIMIT} characters or fewer` };
  }

  let type: MessageTemplateType | undefined;
  if (rawType !== undefined) {
    if (typeof rawType !== 'string') {
      return { ok: false, message: 'type must be a string' };
    }
    const trimmedType = rawType.trim();
    if (!trimmedType) {
      return { ok: false, message: 'type must not be empty' };
    }
    if (!isMessageTemplateType(trimmedType)) {
      return { ok: false, message: 'type must be a valid message template type' };
    }
    type = trimmedType;
  }

  let crmCommentId: string | undefined;
  if (rawCrmCommentId !== undefined) {
    if (typeof rawCrmCommentId !== 'string' || !UUID_PATTERN.test(rawCrmCommentId)) {
      return { ok: false, message: 'crm_comment_id must be a valid UUID' };
    }
    crmCommentId = rawCrmCommentId;
  }

  let repairOrderUuid: string | undefined;
  if (rawRepairOrderUuid !== undefined) {
    if (typeof rawRepairOrderUuid !== 'string' || !UUID_PATTERN.test(rawRepairOrderUuid)) {
      return { ok: false, message: 'repair_order_uuid must be a valid UUID' };
    }
    repairOrderUuid = rawRepairOrderUuid;
  }

  let orderNumber: string | undefined;
  if (rawOrderNumber !== undefined) {
    if (typeof rawOrderNumber !== 'string' || rawOrderNumber.trim().length === 0) {
      return { ok: false, message: 'order_number must be a non-empty string' };
    }
    orderNumber = rawOrderNumber.trim();
  }

  const parsedVariables = parseVariables(rawVariables);
  if (!parsedVariables.ok) return parsedVariables;

  const parsedInlineKeyboard = parseInlineKeyboard(rawInlineKeyboard);
  if (!parsedInlineKeyboard.ok) return parsedInlineKeyboard;

  const parsedSupportReply = parseSupportReply(rawSupportReply);
  if (!parsedSupportReply.ok) return parsedSupportReply;

  return {
    ok: true,
    phoneNumber,
    message,
    variables: parsedVariables.variables,
    inlineKeyboard: parsedInlineKeyboard.inlineKeyboard,
    supportReply: parsedSupportReply.supportReply,
    type,
    crmCommentId,
    repairOrderUuid,
    orderNumber,
  };
};

export const parseSendFileBody = (
  body: unknown,
):
  | {
      ok: true;
      phoneNumber: string;
      fileType: 'warranty' | 'offerta' | 'checklist';
      fileUrl: string;
      fileName?: string;
      variables?: DirectMessageVariables;
      caption?: string;
    }
  | { ok: false; message: string } => {
  if (!isRecord(body)) return { ok: false, message: 'Request body must be a JSON object' };

  const {
    phone_number: rawPhoneNumber,
    file_type: rawFileType,
    file_url: rawFileUrl,
    file_name: rawFileName,
    variables: rawVariables,
    caption: rawCaption,
  } = body as SendFileRequestBody;

  if (typeof rawPhoneNumber !== 'string') {
    return { ok: false, message: 'phone_number must be a string' };
  }
  const phoneNumber = normalizeUzPhone(rawPhoneNumber);
  if (!phoneNumber) {
    return { ok: false, message: 'phone_number must be a valid Uzbek phone number' };
  }

  if (typeof rawFileType !== 'string') {
    return { ok: false, message: 'file_type must be a string' };
  }
  if (rawFileType !== 'warranty' && rawFileType !== 'offerta' && rawFileType !== 'checklist') {
    return { ok: false, message: "file_type must be one of 'warranty', 'offerta', or 'checklist'" };
  }

  if (typeof rawFileUrl !== 'string') {
    return { ok: false, message: 'file_url must be a string' };
  }
  if (!isHttpUrl(rawFileUrl)) {
    return { ok: false, message: 'file_url must be a valid HTTP or HTTPS URL' };
  }

  let fileName: string | undefined;
  if (rawFileName !== undefined) {
    if (typeof rawFileName !== 'string' || rawFileName.trim().length === 0) {
      return { ok: false, message: 'file_name must be a non-empty string' };
    }
    if (!rawFileName.toLowerCase().endsWith('.pdf')) {
      return { ok: false, message: 'file_name must end with a .pdf extension' };
    }
    fileName = rawFileName.trim();
  }

  let caption: string | undefined;
  if (rawCaption !== undefined) {
    if (typeof rawCaption !== 'string') {
      return { ok: false, message: 'caption must be a string' };
    }
    if (rawCaption.length > 1024) {
      return { ok: false, message: 'caption must be 1024 characters or fewer' };
    }
    caption = rawCaption.trim();
  }

  const parsedVariables = parseVariables(rawVariables);
  if (!parsedVariables.ok) return parsedVariables;

  return {
    ok: true,
    phoneNumber,
    fileType: rawFileType,
    fileUrl: rawFileUrl,
    fileName,
    variables: parsedVariables.variables,
    caption,
  };
};
