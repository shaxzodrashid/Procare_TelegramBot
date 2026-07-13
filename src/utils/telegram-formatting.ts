import { escapeHtml } from './html.js';

export const TELEGRAM_PARSE_MODES = ['HTML', 'MarkdownV2'] as const;
export type TelegramParseMode = (typeof TELEGRAM_PARSE_MODES)[number];

export const DEFAULT_TELEGRAM_PARSE_MODE: TelegramParseMode = 'HTML';
export const TELEGRAM_FORMATTED_SOURCE_LIMIT = 16_384;

const MARKDOWN_V2_SPECIAL_CHARACTERS = /[\\_*[\]()~`>#+\-=|{}.!]/g;
const MARKDOWN_V2_CODE_CHARACTERS = /[\\`]/g;
const MARKDOWN_V2_LINK_TARGET_CHARACTERS = /[\\)]/g;
const HTML_TAG_PATTERN = /<[^>]*>/g;
const HTML_ENTITY_PATTERN = /&(?:lt|gt|amp|quot|#(?:\d+|x[0-9a-f]+));/gi;

const escapeTelegramHtml = (value: string): string =>
  escapeHtml(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export const escapeMarkdownV2 = (value: string): string =>
  value.replace(MARKDOWN_V2_SPECIAL_CHARACTERS, '\\$&');

const unescapedOccurrenceCount = (value: string, token: string): number => {
  let count = 0;
  let cursor = 0;
  while (cursor < value.length) {
    const index = value.indexOf(token, cursor);
    if (index === -1) break;

    let precedingBackslashes = 0;
    for (let position = index - 1; position >= 0 && value[position] === '\\'; position -= 1) {
      precedingBackslashes += 1;
    }
    if (precedingBackslashes % 2 === 0) count += 1;
    cursor = index + token.length;
  }
  return count;
};

const markdownV2ContextAt = (source: string, offset: number): 'text' | 'code' | 'url' => {
  const prefix = source.slice(0, offset);
  if (unescapedOccurrenceCount(prefix, '```') % 2 === 1) return 'code';

  const withoutFences = prefix.replace(/```[\s\S]*?```/g, '');
  if (unescapedOccurrenceCount(withoutFences, '`') % 2 === 1) return 'code';

  const linkTargetStart = prefix.lastIndexOf('](');
  const linkTargetEnd = prefix.lastIndexOf(')');
  return linkTargetStart > linkTargetEnd ? 'url' : 'text';
};

export const escapeTelegramVariable = (
  value: string,
  parseMode: TelegramParseMode,
  source: string,
  offset: number,
): string => {
  if (parseMode === 'HTML') return escapeTelegramHtml(value);

  const context = markdownV2ContextAt(source, offset);
  if (context === 'code') return value.replace(MARKDOWN_V2_CODE_CHARACTERS, '\\$&');
  if (context === 'url') return value.replace(MARKDOWN_V2_LINK_TARGET_CHARACTERS, '\\$&');
  return escapeMarkdownV2(value);
};

const decodeHtmlEntity = (entity: string): string => {
  const normalized = entity.toLowerCase();
  if (normalized === '&lt;') return '<';
  if (normalized === '&gt;') return '>';
  if (normalized === '&amp;') return '&';
  if (normalized === '&quot;') return '"';

  const numeric = normalized.slice(2, -1);
  const codePoint = numeric.startsWith('x')
    ? Number.parseInt(numeric.slice(1), 16)
    : Number.parseInt(numeric, 10);
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return entity;

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return entity;
  }
};

const htmlVisibleText = (value: string): string =>
  value
    .replace(HTML_TAG_PATTERN, '')
    .replace(HTML_ENTITY_PATTERN, (entity) => decodeHtmlEntity(entity));

const markdownV2VisibleText = (value: string): string => {
  const withoutFences = value.replace(/```(?:[a-zA-Z0-9_+-]+)?\n?/g, '');
  const withoutLinks = withoutFences
    .replace(/!\[([^\]]*)\]\((?:\\.|[^)])*\)/g, '$1')
    .replace(/\[([^\]]*)\]\((?:\\.|[^)])*\)/g, '$1');

  return withoutLinks
    .replace(/(^|\n)>/g, '$1')
    .replace(/\\([!-~])/g, '$1')
    .replace(/[`*_~|]/g, '');
};

export const telegramFormattedText = (value: string, parseMode: TelegramParseMode): string =>
  parseMode === 'MarkdownV2' ? markdownV2VisibleText(value) : htmlVisibleText(value);
