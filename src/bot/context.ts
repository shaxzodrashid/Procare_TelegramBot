import type { Context, SessionFlavor } from 'grammy';

import type { AdminProfile, ClientProfile, Locale } from '../types/client.js';
import type { MessageTemplateDraft, MessageTemplateField } from '../types/message-template.js';
import type { UserRegistrationState } from '../types/registered-user.js';
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
  | 'admin_template_input'
  | 'support_comment_input'
  | 'admin_client_search_input'
  | 'admin_client_send_custom_message'
  | 'admin_client_template_placeholder';

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

export interface SupportCommentDraft {
  repairOrderId: string;
  orderNumber: string;
  submitting: boolean;
}

export interface BotSession {
  locale: Locale;
  client?: ClientProfile;
  admin?: AdminProfile;
  repairOrdersView?: {
    offset: number;
    orderNumbers: string[];
    selectedOrderNumber?: string;
    selectedRepairOrderId?: string;
  };
  stage?: RegistrationStage;
  unknownClient?: UnknownClientSession;
  repairDraft?: RepairRequestDraft;
  supportComment?: SupportCommentDraft;
  adminTemplateInput?: {
    mode: 'create' | 'edit';
    field: MessageTemplateField;
    templateId?: string;
    draft?: MessageTemplateDraft;
  };
  adminClientFlow?: {
    searchQuery?: string;
    searchResults?: UserRegistrationState[];
    selectedTelegramId?: string;
    selectedTemplateId?: string;
    placeholdersToPrompt?: string[];
    promptedPlaceholders?: Record<string, string>;
    customMessageText?: string;
  };
}

export type BotContext = Context & SessionFlavor<BotSession>;
