export type RepairOrderStatusProgressType = 'linear' | 'terminal';

export interface RepairOrderStatusPermissions {
  can_add: boolean;
  can_view: boolean;
  can_update: boolean;
  can_delete: boolean;
  can_payment_add: boolean;
  can_payment_cancel: boolean;
  can_assign_admin: boolean;
  can_notification: boolean;
  can_notification_bot: boolean;
  can_change_active: boolean;
  can_change_status: boolean;
  can_view_initial_problems: boolean;
  can_change_initial_problems: boolean;
  can_view_final_problems: boolean;
  can_change_final_problems: boolean;
  can_comment: boolean;
  can_pickup_manage: boolean;
  can_delivery_manage: boolean;
  can_view_payments: boolean;
  can_view_history: boolean;
  cannot_continue_without_service_form: boolean;
  cannot_continue_from_mother_branch: boolean;
  cannot_continue_without_final_problems: boolean;
  cannot_continue_without_final_problems_done: boolean;
}

export interface RepairOrderStatusMetrics {
  total_repair_orders: number;
}

export interface CrmRepairOrderStatus {
  id: string;
  name_uz: string;
  name_ru: string;
  name_en: string;
  bg_color: string;
  color: string;
  sort: number;
  can_user_view: boolean;
  is_active: boolean;
  type: string;
  is_protected: boolean;
  can_add_payment: boolean;
  suppress_is_taken_from_mother: boolean;
  customer_code: string | null;
  customer_progress_type: RepairOrderStatusProgressType | null;
  customer_step: number | null;
  customer_total_steps: number | null;
  customer_message_uz: string | null;
  customer_message_ru: string | null;
  customer_message_en: string | null;
  status: 'Open' | 'Deleted';
  branch_id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  permissions: RepairOrderStatusPermissions;
  transitions: string[];
  metrics: RepairOrderStatusMetrics;
}

export interface RepairOrderStatusList {
  statuses: CrmRepairOrderStatus[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

export interface RepairOrderStatusNameRecord {
  id: string;
  crm_status_id: string;
  branch_id: string;
  customer_code: string | null;
  crm_name_uz: string;
  crm_name_ru: string;
  crm_name_en: string;
  sort: number;
  can_user_view: boolean;
  is_active: boolean;
  customer_progress_type: RepairOrderStatusProgressType | null;
  total_repair_orders: number;
  display_name_uz: string | null;
  display_name_ru: string | null;
  created_at?: string;
  updated_at?: string;
}

export type RepairOrderStatusNameUpdate = Pick<
  RepairOrderStatusNameRecord,
  'display_name_uz' | 'display_name_ru'
>;
