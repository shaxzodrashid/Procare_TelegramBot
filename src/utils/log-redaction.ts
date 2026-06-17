export const redactPhoneNumber = (value: string | null | undefined): string | null => {
  if (!value) return null;

  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return '<redacted>';

  const suffix = digits.slice(-4);
  return digits.startsWith('998') ? `+998*****${suffix}` : `*****${suffix}`;
};

export const redactPhoneNumbersInText = (value: string): string =>
  value
    .replace(/\+?998[\s().-]*\d[\d\s().-]{7,}\d/g, (match) => redactPhoneNumber(match) ?? match)
    .replace(/(?<!\d)\d{9}(?!\d)/g, (match) => redactPhoneNumber(match) ?? match);

export const summarizeText = (value: string | null | undefined): { length: number } | null =>
  typeof value === 'string' ? { length: value.length } : null;

export const summarizeUnknownPayload = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return { type: 'array', count: value.length };
  if (typeof value === 'object') {
    return { type: 'object', keys: Object.keys(value).slice(0, 20) };
  }
  if (typeof value === 'string') return { type: 'string', length: value.length };
  return value;
};
