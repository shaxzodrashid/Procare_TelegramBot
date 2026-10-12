import type { SendDirectMessageParams } from '../services/bot-notification.service.js';

export type EmployeeNotificationTemplate = Omit<
  SendDirectMessageParams,
  'phoneNumber' | 'crmClientId' | 'supportReply' | 'crmCommentId'
>;

export interface EmployeeNotificationType {
  key: string;
  name_uz: string;
  name_ru: string;
  is_active: boolean;
  default_enabled: boolean;
  message_template: EmployeeNotificationTemplate;
}

export interface EmployeeNotificationPreference {
  type: EmployeeNotificationType;
  enabled: boolean;
}
