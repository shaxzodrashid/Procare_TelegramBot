import type { Context, SessionFlavor } from 'grammy';
import type { InlineKeyboardMarkup, MessageEntity } from 'grammy/types';

import type { AdminProfile, ClientProfile, Locale } from '../types/client.js';
import type { MessageTemplateDraft, MessageTemplateField } from '../types/message-template.js';
import type { UserRegistrationState } from '../types/registered-user.js';
import type { OsType, PhoneCategory, ProblemCategory } from '../types/repair-order.js';

export type RegistrationStage =
  | 'choosing_language'
  | 'awaiting_phone'
  | 'offering_request'
  | 'client_repair_request'
  | 'choosing_os'
  | 'choosing_category'
  | 'awaiting_custom_category'
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
  | 'admin_status_name_input'
  | 'support_comment_input'
  | 'admin_client_search_input'
  | 'admin_client_send_custom_message'
  | 'admin_client_template_placeholder'
  | 'admin_export_period_input'
  | 'developer_error_location_input'
  | 'developer_error_message_uz_input'
  | 'developer_error_message_ru_input'
  | 'direct_message_rejection_note';

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
  customCategory?: string;
  problems: ProblemCategory[];
  selectedProblemIds: string[];
  note: string;
  submitting: boolean;
}

export interface SupportCommentDraft {
  repairOrderId: string;
  orderNumber: string;
  assignedAdminIds: string[];
  submitting: boolean;
}

export interface BotSession {
  locale: Locale;
  client?: ClientProfile;
  admin?: AdminProfile;
  developer?: {
    is_active: boolean;
    test_phone_number?: string;
  };
  repairOrdersView?: {
    offset: number;
    orderNumbers: string[];
    selectedOrderNumber?: string;
    selectedRepairOrderId?: string;
    selectedAssignedAdminIds?: string[];
  };
  directMessageViews?: Record<
    string,
    {
      text: string;
      entities?: MessageEntity[];
      contentType: 'text' | 'caption';
      repairOrderUuid: string;
      inlineKeyboard: InlineKeyboardMarkup['inline_keyboard'];
    }
  >;
  directMessageApproval?: {
    repairOrderUuid: string;
    orderNumber: string;
    messageId: string;
    mode: 'approve_confirmation' | 'rejection_note' | 'reject_confirmation';
    note?: string;
    submitting: boolean;
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
  adminStatusNameInput?: {
    statusId: string;
    field: 'display_name_uz' | 'display_name_ru';
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
  developerFlow?: {
    endpointKey?: string;
    location?: string;
    messageUz?: string;
  };
}

export type BotContext = Context & SessionFlavor<BotSession>;
