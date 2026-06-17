import type { Context, SessionFlavor } from 'grammy';

import type { AdminProfile, ClientProfile, Locale } from '../types/client.js';
import type { OsType, PhoneCategory, ProblemCategory } from '../types/repair-order.js';

export type RegistrationStage =
  | 'choosing_language'
  | 'awaiting_phone'
  | 'offering_request'
  | 'choosing_os'
  | 'choosing_category'
  | 'choosing_problems'
  | 'awaiting_note'
  | 'confirming_request'
  | 'request_submitted'
  | 'request_declined';

export interface UnknownClientSession {
  phoneNumber: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
}

export interface RepairRequestDraft {
  osTypes: OsType[];
  selectedOs?: OsType;
  categoryPath: PhoneCategory[];
  categories: PhoneCategory[];
  categoryPage: number;
  selectedCategory?: PhoneCategory;
  problems: ProblemCategory[];
  selectedProblemIds: string[];
  note: string;
  submitting: boolean;
}

export interface BotSession {
  locale: Locale;
  client?: ClientProfile;
  admin?: AdminProfile;
  stage?: RegistrationStage;
  unknownClient?: UnknownClientSession;
  repairDraft?: RepairRequestDraft;
}

export type BotContext = Context & SessionFlavor<BotSession>;
