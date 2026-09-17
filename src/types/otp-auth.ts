export interface OtpSessionResponse {
  status: 'PENDING_TELEGRAM' | 'OTP_SENT' | 'VERIFIED' | 'EXPIRED' | string;
  phone_number?: string;
  is_new_user?: boolean;
}

export interface VerifyContactParams {
  session_token: string;
  telegram_user_id: number | string;
  telegram_chat_id: number | string;
  contact_phone: string;
  contact_user_id?: number | string | null;
}

export type VerifyContactResult =
  | { success: true; user?: unknown }
  | {
      success: false;
      error:
        | 'PHONE_NUMBER_MISMATCH'
        | 'SENDER_NOT_CONTACT_OWNER'
        | 'SESSION_EXPIRED'
        | 'SESSION_NOT_FOUND'
        | 'INVALID_REQUEST'
        | 'UNAVAILABLE'
        | string;
      message?: string;
    };

export interface OtpAuthGateway {
  getSession(sessionToken: string): Promise<OtpSessionResponse | null>;
  verifyContact(params: VerifyContactParams): Promise<VerifyContactResult>;
}
