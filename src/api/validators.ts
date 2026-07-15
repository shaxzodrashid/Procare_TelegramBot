import {
  TELEGRAM_TEXT_LIMIT,
  type DirectMessageAttachment,
  type DirectMessageInlineKeyboard,
  type DirectMessageRowsInlineKeyboard,
  type DirectMessageSupportReply,
  type DirectMessageVariables,
  type DirectMessageLocalizedVariables,
  type DirectMessageLocalizedMessages,
} from '../services/bot-notification.service.js';
import {
  DEFAULT_TELEGRAM_PARSE_MODE,
  TELEGRAM_FORMATTED_SOURCE_LIMIT,
  TELEGRAM_PARSE_MODES,
  type TelegramParseMode,
} from '../utils/telegram-formatting.js';
import { normalizeUzPhone } from '../utils/phone.js';
import { isMessageTemplateType, type MessageTemplateType } from '../types/message-template.js';

export interface SendMessageRequestBody {
  phone_number?: unknown;
  message?: unknown;
  localized_messages?: unknown;
  variables?: unknown;
  localized_variables?: unknown;
  parse_mode?: unknown;
  inline_keyboard?: unknown;
  support_reply?: unknown;
  type?: unknown;
  crm_comment_id?: unknown;
  repair_order_uuid?: unknown;
  order_number?: unknown;
  attachments?: unknown;
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
const MAX_VARIABLE_COUNT = 100;
const MAX_VARIABLE_STRING_LENGTH = TELEGRAM_TEXT_LIMIT;
const MAX_DIRECT_MESSAGE_ATTACHMENTS = 5;
const MAX_ATTACHMENT_FILE_NAME_LENGTH = 255;

const parseLocalizedMessages = (
  value: unknown,
):
  | { ok: true; localizedMessages?: DirectMessageLocalizedMessages }
  | { ok: false; message: string } => {
  if (value === undefined) return { ok: true };
  if (!isRecord(value)) return { ok: false, message: 'localized_messages must be a JSON object' };
  const uz = value.uz;
  const ru = value.ru;
  const en = value.en;
  if (typeof uz !== 'string' || !uz.trim()) {
    return { ok: false, message: 'localized_messages.uz must be a non-empty string' };
  }
  if (typeof ru !== 'string' || !ru.trim()) {
    return { ok: false, message: 'localized_messages.ru must be a non-empty string' };
  }
  if (
    uz.trim().length > TELEGRAM_FORMATTED_SOURCE_LIMIT ||
    ru.trim().length > TELEGRAM_FORMATTED_SOURCE_LIMIT
  ) {
    return {
      ok: false,
      message: `localized messages must be ${TELEGRAM_FORMATTED_SOURCE_LIMIT} source characters or fewer`,
    };
  }
  if (
    en !== undefined &&
    en !== null &&
    (typeof en !== 'string' || en.trim().length > TELEGRAM_FORMATTED_SOURCE_LIMIT)
  ) {
    return {
      ok: false,
      message: `localized_messages.en must be a string with at most ${TELEGRAM_FORMATTED_SOURCE_LIMIT} source characters`,
    };
  }
  return {
    ok: true,
    localizedMessages: {
      uz: uz.trim(),
      ru: ru.trim(),
      en: typeof en === 'string' ? en.trim() || null : null,
    },
  };
};

export const parseVariables = (
  value: unknown,
): { ok: true; variables: DirectMessageVariables } | { ok: false; message: string } => {
  if (value === undefined) return { ok: true, variables: {} };
  if (!isRecord(value)) return { ok: false, message: 'variables must be a JSON object' };
  if (Object.keys(value).length > MAX_VARIABLE_COUNT) {
    return { ok: false, message: `variables may contain at most ${MAX_VARIABLE_COUNT} entries` };
  }

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
    if (typeof rawVariable === 'string' && rawVariable.length > MAX_VARIABLE_STRING_LENGTH) {
      return {
        ok: false,
        message: `variable string values must be ${MAX_VARIABLE_STRING_LENGTH} characters or fewer`,
      };
    }
    variables[key] = rawVariable;
  }

  return { ok: true, variables };
};

const isDirectMessageVariableValue = (value: unknown): value is DirectMessageVariables[string] =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

export const parseLocalizedVariables = (
  value: unknown,
):
  | { ok: true; localizedVariables: DirectMessageLocalizedVariables }
  | { ok: false; message: string } => {
  if (value === undefined) return { ok: true, localizedVariables: {} };
  if (!isRecord(value)) {
    return { ok: false, message: 'localized_variables must be a JSON object' };
  }
  if (Object.keys(value).length > MAX_VARIABLE_COUNT) {
    return {
      ok: false,
      message: `localized_variables may contain at most ${MAX_VARIABLE_COUNT} entries`,
    };
  }

  const localizedVariables: DirectMessageLocalizedVariables = {};
  for (const [key, rawLocalizedVariable] of Object.entries(value)) {
    if (!/^[a-zA-Z0-9_]{1,64}$/.test(key)) {
      return {
        ok: false,
        message: 'localized variable names may contain only letters, numbers, and underscores',
      };
    }
    if (!isRecord(rawLocalizedVariable)) {
      return {
        ok: false,
        message: `localized_variables.${key} must be a JSON object`,
      };
    }
    if (!Object.hasOwn(rawLocalizedVariable, 'uz') || !Object.hasOwn(rawLocalizedVariable, 'ru')) {
      return {
        ok: false,
        message: `localized_variables.${key} must define uz and ru values`,
      };
    }

    const { uz, ru, en } = rawLocalizedVariable;
    for (const [locale, localizedValue] of Object.entries({ uz, ru, en })) {
      if (locale === 'en' && localizedValue === undefined) continue;
      if (!isDirectMessageVariableValue(localizedValue)) {
        return {
          ok: false,
          message: `localized_variables.${key}.${locale} must be a string, number, boolean, or null`,
        };
      }
      if (
        typeof localizedValue === 'string' &&
        localizedValue.length > MAX_VARIABLE_STRING_LENGTH
      ) {
        return {
          ok: false,
          message: `localized_variables.${key}.${locale} must be ${MAX_VARIABLE_STRING_LENGTH} characters or fewer`,
        };
      }
    }

    localizedVariables[key] = {
      uz: uz as DirectMessageVariables[string],
      ru: ru as DirectMessageVariables[string],
      ...(en !== undefined ? { en: en as DirectMessageVariables[string] } : {}),
    };
  }

  return { ok: true, localizedVariables };
};

const parseTelegramParseMode = (
  value: unknown,
): { ok: true; parseMode: TelegramParseMode } | { ok: false; message: string } => {
  if (value === undefined) return { ok: true, parseMode: DEFAULT_TELEGRAM_PARSE_MODE };
  if (typeof value !== 'string' || !TELEGRAM_PARSE_MODES.includes(value as TelegramParseMode)) {
    return { ok: false, message: 'parse_mode must be HTML or MarkdownV2' };
  }
  return { ok: true, parseMode: value as TelegramParseMode };
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
  | { ok: true; button: DirectMessageRowsInlineKeyboard['rows'][number][number] }
  | { ok: false; message: string } => {
  if (!isRecord(value)) return { ok: false, message: 'inline keyboard buttons must be objects' };

  const { type, text, localized_text: localizedText } = value;
  if (
    type !== 'url' &&
    type !== 'repair_order' &&
    type !== 'details' &&
    type !== 'approval' &&
    type !== 'rating'
  ) {
    return {
      ok: false,
      message:
        'inline keyboard button type must be url, details, approval, rating, or repair_order',
    };
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

  let parsedLocalizedText;
  if (localizedText !== undefined) {
    if (!isRecord(localizedText)) {
      return { ok: false, message: 'inline keyboard localized_text must be an object' };
    }
    const { uz, ru, en } = localizedText;
    for (const [locale, label] of [
      ['uz', uz],
      ['ru', ru],
    ] as const) {
      if (
        typeof label !== 'string' ||
        !label.trim() ||
        label.trim().length > MAX_INLINE_KEYBOARD_TEXT_LENGTH
      ) {
        return {
          ok: false,
          message: `inline keyboard localized_text.${locale} must be a non-empty string with at most ${MAX_INLINE_KEYBOARD_TEXT_LENGTH} characters`,
        };
      }
    }
    if (
      en !== undefined &&
      en !== null &&
      (typeof en !== 'string' || !en.trim() || en.trim().length > MAX_INLINE_KEYBOARD_TEXT_LENGTH)
    ) {
      return {
        ok: false,
        message: `inline keyboard localized_text.en must be null or a non-empty string with at most ${MAX_INLINE_KEYBOARD_TEXT_LENGTH} characters`,
      };
    }
    parsedLocalizedText = {
      uz: (uz as string).trim(),
      ru: (ru as string).trim(),
      en: typeof en === 'string' ? en.trim() : null,
    };
  }

  if (typeof value.repair_order_uuid !== 'string' || !UUID_PATTERN.test(value.repair_order_uuid)) {
    return { ok: false, message: 'repair_order buttons require a valid repair_order_uuid' };
  }

  return {
    ok: true,
    button: {
      type,
      ...(typeof text === 'string' ? { text: text.trim() } : {}),
      ...(parsedLocalizedText ? { localizedText: parsedLocalizedText } : {}),
      repairOrderUuid: value.repair_order_uuid,
    },
  };
};

export const parseInlineKeyboard = (
  value: unknown,
): { ok: true; inlineKeyboard?: DirectMessageInlineKeyboard } | { ok: false; message: string } => {
  if (value === undefined) return { ok: true };
  if (!isRecord(value)) return { ok: false, message: 'inline_keyboard must be a JSON object' };

  if (
    value.type === 'repair_order' ||
    value.type === 'details' ||
    value.type === 'approval' ||
    value.type === 'rating'
  ) {
    if (
      typeof value.repair_order_uuid !== 'string' ||
      !UUID_PATTERN.test(value.repair_order_uuid)
    ) {
      return {
        ok: false,
        message: `${String(value.type)} keyboards require a valid repair_order_uuid`,
      };
    }
    if (value.text !== undefined) {
      if (value.type === 'approval' || value.type === 'rating') {
        return { ok: false, message: `${String(value.type)} keyboards do not accept text` };
      }
      if (typeof value.text !== 'string' || value.text.trim().length === 0) {
        return { ok: false, message: 'details keyboard text must be a non-empty string' };
      }
      if (value.text.trim().length > MAX_INLINE_KEYBOARD_TEXT_LENGTH) {
        return {
          ok: false,
          message: `details keyboard text must be ${MAX_INLINE_KEYBOARD_TEXT_LENGTH} characters or fewer`,
        };
      }
    }
    return {
      ok: true,
      inlineKeyboard: {
        type: value.type === 'repair_order' ? 'details' : value.type,
        repairOrderUuid: value.repair_order_uuid,
        ...(typeof value.text === 'string' ? { text: value.text.trim() } : {}),
      },
    };
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
  const rows: DirectMessageRowsInlineKeyboard['rows'] = [];
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

    const row: DirectMessageRowsInlineKeyboard['rows'][number] = [];
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

export const parseDirectMessageAttachments = (
  value: unknown,
): { ok: true; attachments?: DirectMessageAttachment[] } | { ok: false; message: string } => {
  if (value === undefined) return { ok: true };
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, message: 'attachments must be a non-empty array when provided' };
  }
  if (value.length > MAX_DIRECT_MESSAGE_ATTACHMENTS) {
    return {
      ok: false,
      message: `attachments may contain at most ${MAX_DIRECT_MESSAGE_ATTACHMENTS} photos`,
    };
  }

  const attachments: DirectMessageAttachment[] = [];
  for (const [index, rawAttachment] of value.entries()) {
    if (!isRecord(rawAttachment) || rawAttachment.type !== 'photo') {
      return { ok: false, message: `attachments[${index}] must be a photo object` };
    }
    if (typeof rawAttachment.url !== 'string' || !isHttpUrl(rawAttachment.url)) {
      return {
        ok: false,
        message: `attachments[${index}].url must be a valid HTTP or HTTPS URL`,
      };
    }
    if (
      rawAttachment.file_name !== undefined &&
      (typeof rawAttachment.file_name !== 'string' ||
        !rawAttachment.file_name.trim() ||
        rawAttachment.file_name.trim().length > MAX_ATTACHMENT_FILE_NAME_LENGTH)
    ) {
      return {
        ok: false,
        message: `attachments[${index}].file_name must be a non-empty string with at most ${MAX_ATTACHMENT_FILE_NAME_LENGTH} characters`,
      };
    }
    attachments.push({
      type: 'photo',
      url: rawAttachment.url,
      ...(typeof rawAttachment.file_name === 'string'
        ? { fileName: rawAttachment.file_name.trim() }
        : {}),
    });
  }
  return { ok: true, attachments };
};

export const parseSendMessageBody = (
  body: unknown,
):
  | {
      ok: true;
      phoneNumber: string;
      message?: string;
      localizedMessages?: DirectMessageLocalizedMessages;
      variables: DirectMessageVariables;
      localizedVariables: DirectMessageLocalizedVariables;
      parseMode: TelegramParseMode;
      inlineKeyboard?: DirectMessageInlineKeyboard;
      supportReply?: DirectMessageSupportReply;
      type?: MessageTemplateType;
      crmCommentId?: string;
      repairOrderUuid?: string;
      orderNumber?: string;
      attachments?: DirectMessageAttachment[];
    }
  | { ok: false; message: string } => {
  if (!isRecord(body)) return { ok: false, message: 'Request body must be a JSON object' };

  const {
    phone_number: rawPhoneNumber,
    message: rawMessage,
    localized_messages: rawLocalizedMessages,
    variables: rawVariables,
    localized_variables: rawLocalizedVariables,
    parse_mode: rawParseMode,
    inline_keyboard: rawInlineKeyboard,
    support_reply: rawSupportReply,
    type: rawType,
    crm_comment_id: rawCrmCommentId,
    repair_order_uuid: rawRepairOrderUuid,
    order_number: rawOrderNumber,
    attachments: rawAttachments,
  } = body as SendMessageRequestBody;
  if (typeof rawPhoneNumber !== 'string') {
    return { ok: false, message: 'phone_number must be a string' };
  }
  const phoneNumber = normalizeUzPhone(rawPhoneNumber);
  if (!phoneNumber)
    return { ok: false, message: 'phone_number must be a valid Uzbek phone number' };

  let message: string | undefined;
  if (rawMessage !== undefined) {
    if (typeof rawMessage !== 'string') return { ok: false, message: 'message must be a string' };
    message = rawMessage.trim();
    if (!message) return { ok: false, message: 'message must not be empty' };
    if (message.length > TELEGRAM_FORMATTED_SOURCE_LIMIT) {
      return {
        ok: false,
        message: `message must be ${TELEGRAM_FORMATTED_SOURCE_LIMIT} source characters or fewer`,
      };
    }
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

  const parsedLocalizedVariables = parseLocalizedVariables(rawLocalizedVariables);
  if (!parsedLocalizedVariables.ok) return parsedLocalizedVariables;

  const parsedParseMode = parseTelegramParseMode(rawParseMode);
  if (!parsedParseMode.ok) return parsedParseMode;

  const parsedInlineKeyboard = parseInlineKeyboard(rawInlineKeyboard);
  if (!parsedInlineKeyboard.ok) return parsedInlineKeyboard;

  const parsedSupportReply = parseSupportReply(rawSupportReply);
  if (!parsedSupportReply.ok) return parsedSupportReply;

  const parsedLocalizedMessages = parseLocalizedMessages(rawLocalizedMessages);
  if (!parsedLocalizedMessages.ok) return parsedLocalizedMessages;

  const parsedAttachments = parseDirectMessageAttachments(rawAttachments);
  if (!parsedAttachments.ok) return parsedAttachments;

  if (!message && !parsedLocalizedMessages.localizedMessages && !parsedAttachments.attachments) {
    return { ok: false, message: 'message, localized_messages, or attachments must be provided' };
  }
  if (
    parsedInlineKeyboard.inlineKeyboard &&
    !message &&
    !parsedLocalizedMessages.localizedMessages
  ) {
    return { ok: false, message: 'inline_keyboard requires message text' };
  }

  return {
    ok: true,
    phoneNumber,
    message,
    localizedMessages: parsedLocalizedMessages.localizedMessages,
    variables: parsedVariables.variables,
    localizedVariables: parsedLocalizedVariables.localizedVariables,
    parseMode: parsedParseMode.parseMode,
    inlineKeyboard: parsedInlineKeyboard.inlineKeyboard,
    supportReply: parsedSupportReply.supportReply,
    type,
    crmCommentId,
    repairOrderUuid,
    orderNumber,
    attachments: parsedAttachments.attachments,
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
