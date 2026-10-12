import type {
  OtpAuthGateway,
  OtpSessionResponse,
  VerifyContactParams,
  VerifyContactResult,
} from '../types/otp-auth.js';
import type { Logger } from '../utils/logger.js';
import { normalizeUzPhone } from '../utils/phone.js';

export interface OtpAuthServiceOptions {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export class HttpOtpAuthService implements OtpAuthGateway {
  private readonly baseUrl: string;

  constructor(
    private readonly options: OtpAuthServiceOptions,
    private readonly logger: Logger,
  ) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  async getSession(sessionToken: string): Promise<OtpSessionResponse | null> {
    const trimmed = sessionToken.trim();
    if (!trimmed) return null;

    const path = `/api/v1/auth/session-status?session_token=${encodeURIComponent(trimmed)}`;
    const url = `${this.baseUrl}${path}`;
    const attempts = this.options.maxRetries + 1;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.requestSession(url);
      } catch {
        const isLast = attempt === attempts;
        if (isLast) {
          this.logger.warn('Failed to lookup OTP session after max retries');
          return null;
        }

        const delayMs = 250 * 2 ** (attempt - 1);
        this.logger.warn(`OTP session lookup attempt ${attempt} failed; retrying in ${delayMs}ms`);
        await (this.options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(
          delayMs,
        );
      }
    }

    return null;
  }

  async verifyContact(params: VerifyContactParams): Promise<VerifyContactResult> {
    const path = '/api/v1/internal/telegram/verify-contact';
    const url = `${this.baseUrl}${path}`;
    const normalizedPhone = normalizeUzPhone(params.contact_phone) ?? params.contact_phone;

    const payload = {
      session_token: params.session_token.trim(),
      telegram_user_id: Number(params.telegram_user_id),
      telegram_chat_id: Number(params.telegram_chat_id),
      contact_phone: normalizedPhone,
      contact_user_id:
        params.contact_user_id !== undefined && params.contact_user_id !== null
          ? Number(params.contact_user_id)
          : Number(params.telegram_user_id),
      ...(params.first_name !== undefined ? { first_name: params.first_name.trim() } : {}),
      ...(params.last_name !== undefined ? { last_name: params.last_name.trim() } : {}),
    };

    const fetchImpl = this.options.fetchImpl ?? fetch;

    this.logger.extra('Internal Telegram verify-contact request', {
      method: 'POST',
      path,
    });

    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(
            `${this.options.username}:${this.options.password}`,
          ).toString('base64')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });

      const responseBody = (await response.json().catch(() => null)) as unknown;

      this.logger.extra('Internal Telegram verify-contact response', {
        status: response.status,
        ok: response.ok,
      });

      if (response.status === 200) {
        if (isRecord(responseBody) && responseBody.success === false) {
          const errorCode = String(responseBody.error ?? 'UNKNOWN_ERROR');
          return {
            success: false,
            error: errorCode,
            message: typeof responseBody.message === 'string' ? responseBody.message : undefined,
          };
        }
        if (!isRecord(responseBody) || responseBody.success !== true) {
          return { success: false, error: 'UNAVAILABLE', message: 'Invalid verification response' };
        }
        return { success: true, user: responseBody.user };
      }

      if (response.status === 400) {
        if (isRecord(responseBody) && responseBody.error === 'PROFILE_NAMES_REQUIRED') {
          const fields = responseBody.missing_fields;
          if (
            !Array.isArray(fields) ||
            fields.length === 0 ||
            fields.some((field) => field !== 'first_name' && field !== 'last_name') ||
            new Set(fields).size !== fields.length ||
            (fields.length === 2 && fields[0] !== 'first_name')
          )
            return { success: false, error: 'UNAVAILABLE' };
          return { success: false, error: 'PROFILE_NAMES_REQUIRED', missing_fields: fields };
        }
        const errorCode =
          isRecord(responseBody) && typeof responseBody.error === 'string'
            ? responseBody.error
            : 'PHONE_NUMBER_MISMATCH';
        const message =
          isRecord(responseBody) && typeof responseBody.message === 'string'
            ? responseBody.message
            : undefined;
        return {
          success: false,
          error: errorCode,
          message,
          ...(isRecord(responseBody) && typeof responseBody.location === 'string'
            ? { location: responseBody.location }
            : {}),
        };
      }

      if (response.status === 403) {
        const errorCode =
          isRecord(responseBody) && typeof responseBody.error === 'string'
            ? responseBody.error
            : 'SENDER_NOT_CONTACT_OWNER';
        return { success: false, error: errorCode };
      }

      if (response.status === 404) {
        return { success: false, error: 'SESSION_NOT_FOUND' };
      }

      return {
        success: false,
        error: 'UNAVAILABLE',
        message: `Backend returned status ${response.status}`,
      };
    } catch {
      this.logger.warn('Network request failed for internal verify-contact');
      return {
        success: false,
        error: 'UNAVAILABLE',
        message: 'Network error',
      };
    }
  }

  private async requestSession(url: string): Promise<OtpSessionResponse | null> {
    const fetchImpl = this.options.fetchImpl ?? fetch;

    this.logger.extra('OTP session lookup request', {
      method: 'GET',
      path: '/api/v1/auth/session-status',
      timeoutMs: this.options.timeoutMs,
    });

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          authorization: `Basic ${Buffer.from(
            `${this.options.username}:${this.options.password}`,
          ).toString('base64')}`,
          'content-type': 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch {
      this.logger.warn('OTP session lookup network failure');
      throw new Error('OTP session lookup network failure');
    }

    if (response.status === 404 || response.status === 400) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`OTP session lookup failed with HTTP ${response.status}`);
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    if (!isRecord(payload) || typeof payload.status !== 'string') {
      this.logger.warn('OTP session lookup returned invalid response shape', {
        status: response.status,
      });
      return null;
    }

    return {
      status: payload.status,
      phone_number: typeof payload.phone_number === 'string' ? payload.phone_number : undefined,
      is_new_user: typeof payload.is_new_user === 'boolean' ? payload.is_new_user : undefined,
    };
  }
}
