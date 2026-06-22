import type { AdminProfile, ClientProfile, RegistrationResult } from '../types/client.js';
import {
  redactPhoneNumber,
  redactPhoneNumbersInText,
  summarizeUnknownPayload,
} from '../utils/log-redaction.js';
import type { Logger } from '../utils/logger.js';
import { normalizeUzPhone } from '../utils/phone.js';

export type RegistrationFailureCode =
  | 'invalid_phone'
  | 'not_found'
  | 'unauthorized'
  | 'maintenance'
  | 'unavailable'
  | 'invalid_response';

export class RegistrationError extends Error {
  constructor(
    public readonly code: RegistrationFailureCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'RegistrationError';
  }
}

export interface ClientRegistrationGateway {
  registerByPhone(phoneNumber: string): Promise<RegistrationResult>;
}

interface ErrorEnvelope {
  message?: string;
}

const registrationPath = '/api/v1/users/register-client';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isAdminProfile = (value: unknown): value is AdminProfile => {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    isNullableString(value.first_name) &&
    isNullableString(value.last_name) &&
    typeof value.phone_number === 'string' &&
    typeof value.phone_verified === 'boolean' &&
    isNullableString(value.language) &&
    typeof value.status === 'string' &&
    typeof value.is_active === 'boolean' &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string'
  );
};

const isClientProfile = (value: unknown): value is ClientProfile => {
  if (!isRecord(value)) return false;
  return (
    value.account_type === 'client' &&
    typeof value.client_id === 'string' &&
    isNullableString(value.first_name) &&
    isNullableString(value.last_name) &&
    isNullableString(value.language) &&
    typeof value.has_repair_orders === 'boolean' &&
    typeof value.is_admin === 'boolean' &&
    (value.admin === null || isAdminProfile(value.admin)) &&
    value.is_admin === (value.admin !== null)
  );
};

const toAdminProfile = (value: AdminProfile): AdminProfile => ({
  id: value.id,
  first_name: value.first_name,
  last_name: value.last_name,
  phone_number: value.phone_number,
  phone_verified: value.phone_verified,
  language: value.language,
  status: value.status,
  is_active: value.is_active,
  created_at: value.created_at,
  updated_at: value.updated_at,
});

const toClientProfile = (value: ClientProfile): ClientProfile => ({
  account_type: 'client',
  client_id: value.client_id,
  first_name: value.first_name,
  last_name: value.last_name,
  language: value.language,
  has_repair_orders: value.has_repair_orders,
  is_admin: value.is_admin,
  admin: value.admin ? toAdminProfile(value.admin) : null,
});

const parseRegistrationResult = (value: unknown): RegistrationResult | null => {
  if (!isRecord(value)) return null;
  if (isClientProfile(value)) return toClientProfile(value);
  if (value.account_type === 'admin' && value.is_admin === true && isAdminProfile(value.admin)) {
    return {
      account_type: 'admin',
      is_admin: true,
      admin: toAdminProfile(value.admin),
    };
  }
  return null;
};

const summarizeAdminProfile = (profile: AdminProfile): Record<string, unknown> => ({
  id: profile.id,
  status: profile.status,
  is_active: profile.is_active,
  phone_number: redactPhoneNumber(profile.phone_number),
  phone_verified: profile.phone_verified,
  language: profile.language,
});

const summarizeClientProfile = (profile: ClientProfile): Record<string, unknown> => ({
  account_type: profile.account_type,
  client_id: profile.client_id,
  is_admin: profile.is_admin,
  admin: profile.admin ? summarizeAdminProfile(profile.admin) : null,
  language: profile.language,
  has_repair_orders: profile.has_repair_orders,
});

const summarizeRegistrationPayload = (payload: unknown): unknown => {
  const registration = parseRegistrationResult(payload);
  if (registration?.account_type === 'client') return summarizeClientProfile(registration);
  if (registration?.account_type === 'admin') {
    return {
      account_type: registration.account_type,
      is_admin: registration.is_admin,
      admin: summarizeAdminProfile(registration.admin),
    };
  }
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as ErrorEnvelope).message;
    return { message: typeof message === 'string' ? redactPhoneNumbersInText(message) : undefined };
  }
  return summarizeUnknownPayload(payload);
};

export class HttpClientRegistrationService implements ClientRegistrationGateway {
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

  async registerByPhone(phoneNumber: string): Promise<RegistrationResult> {
    const normalizedPhone = normalizeUzPhone(phoneNumber);
    if (!normalizedPhone) {
      throw new RegistrationError('invalid_phone', 'Invalid Uzbek phone number');
    }

    const attempts = this.options.maxRetries + 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.request(normalizedPhone);
      } catch (error) {
        const retryable =
          error instanceof RegistrationError &&
          (error.code === 'maintenance' || error.code === 'unavailable');

        if (!retryable || attempt === attempts) throw error;

        const delayMs = 250 * 2 ** (attempt - 1);
        this.logger.warn(`CRM registration attempt ${attempt} failed; retrying in ${delayMs}ms`, {
          code: error.code,
          status: error.status,
        });
        await (this.options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(
          delayMs,
        );
      }
    }

    throw new RegistrationError('unavailable', 'CRM registration request failed');
  }

  private async request(phoneNumber: string): Promise<RegistrationResult> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    this.logger.extra('CRM registration request', {
      method: 'POST',
      path: registrationPath,
      headers: {
        authorization: 'Basic <redacted>',
        'content-type': 'application/json',
      },
      body: { phone_number: redactPhoneNumber(phoneNumber) },
      timeoutMs: this.options.timeoutMs,
    });

    try {
      response = await fetchImpl(`${this.options.baseUrl}${registrationPath}`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(
            `${this.options.username}:${this.options.password}`,
          ).toString('base64')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ phone_number: phoneNumber }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      this.logger.error('CRM registration network request failed', error);
      throw new RegistrationError('unavailable', 'CRM service is unavailable');
    }

    const payload = (await response.json().catch(() => null)) as
      | ErrorEnvelope
      | RegistrationResult
      | null;

    this.logger.extra('CRM registration response', {
      method: 'POST',
      path: registrationPath,
      status: response.status,
      ok: response.ok,
      body: summarizeRegistrationPayload(payload),
    });

    if (response.ok) {
      const registration = parseRegistrationResult(payload);
      if (!registration) {
        throw new RegistrationError(
          'invalid_response',
          'CRM returned an invalid registration result',
        );
      }
      return registration;
    }

    const message =
      payload && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : `CRM request failed with status ${response.status}`;

    if (response.status === 400) throw new RegistrationError('invalid_phone', message, 400);
    if (response.status === 401) throw new RegistrationError('unauthorized', message, 401);
    if (response.status === 404) throw new RegistrationError('not_found', message, 404);
    if (response.status === 503) throw new RegistrationError('maintenance', message, 503);
    throw new RegistrationError('unavailable', message, response.status);
  }
}
