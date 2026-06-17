import type { Context, SessionFlavor } from 'grammy';

import type { AdminProfile, ClientProfile, Locale } from '../types/client.js';
import type { MessageTemplateDraft, MessageTemplateField } from '../types/message-template.js';
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
  | 'request_declined'
  | 'settings'
  | 'settings_awaiting_name'
  | 'settings_awaiting_phone'
  | 'settings_choosing_language'
  | 'admin_template_input';

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
  adminTemplateInput?: {
    mode: 'create' | 'edit';
    field: MessageTemplateField;
    templateId?: string;
    draft?: MessageTemplateDraft;
  };
}

export type BotContext = Context & SessionFlavor<BotSession>;
