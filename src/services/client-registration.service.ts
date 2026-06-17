import type { ClientProfile } from '../types/client.js';
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
  registerByPhone(phoneNumber: string): Promise<ClientProfile>;
}

interface ErrorEnvelope {
  message?: string;
}

const registrationPath = '/api/v1/users/register-client';

const isClientProfile = (value: unknown): value is ClientProfile => {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<ClientProfile>;
  return (
    typeof profile.id === 'string' &&
    typeof profile.phone_number1 === 'string' &&
    Array.isArray(profile.repair_orders)
  );
};

const summarizeClientProfile = (profile: ClientProfile): Record<string, unknown> => ({
  id: profile.id,
  customer_code: profile.customer_code,
  status: profile.status,
  is_active: profile.is_active,
  source: profile.source,
  phone_number1: redactPhoneNumber(profile.phone_number1),
  phone_number2: redactPhoneNumber(profile.phone_number2),
  phone_verified: profile.phone_verified,
  language: profile.language,
  telegram_chat_id_present: Boolean(profile.telegram_chat_id),
  telegram_username_present: Boolean(profile.telegram_username),
  repair_orders_count: profile.repair_orders.length,
});

const summarizeRegistrationPayload = (payload: unknown): unknown => {
  if (isClientProfile(payload)) return summarizeClientProfile(payload);
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

  async registerByPhone(phoneNumber: string): Promise<ClientProfile> {
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

  private async request(phoneNumber: string): Promise<ClientProfile> {
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
      | ClientProfile
      | null;

    this.logger.extra('CRM registration response', {
      method: 'POST',
      path: registrationPath,
      status: response.status,
      ok: response.ok,
      body: summarizeRegistrationPayload(payload),
    });

    if (response.ok) {
      if (!isClientProfile(payload)) {
        throw new RegistrationError('invalid_response', 'CRM returned an invalid client profile');
      }
      return payload;
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
