const UZ_LOCAL_DIGITS = 9;

export const normalizeUzPhone = (input: string): string | null => {
  const digits = input.replace(/\D/g, '');
  const local =
    digits.length === UZ_LOCAL_DIGITS
      ? digits
      : digits.length === 12 && digits.startsWith('998')
        ? digits.slice(3)
        : null;

  if (!local || !/^[3-9]\d{8}$/.test(local)) return null;
  return `+998${local}`;
};
