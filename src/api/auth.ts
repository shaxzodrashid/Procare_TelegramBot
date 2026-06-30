import { timingSafeEqual } from 'node:crypto';

/**
 * Checks if the authorization header matches the configured API token.
 */
export const isAuthorized = (authorization: string | undefined, expectedToken: string): boolean => {
  if (!expectedToken) return false;

  const prefix = 'Bearer ';
  if (!authorization?.startsWith(prefix)) return false;

  const token = authorization.slice(prefix.length).trim();
  const actual = Buffer.from(token);
  const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
