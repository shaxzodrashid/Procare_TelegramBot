export interface CrmRepairOrderStatus {
  id: string;
  name_uz: string;
  name_ru: string;
  name_en: string;
}

export interface RepairOrderStatusList {
  statuses: CrmRepairOrderStatus[];
}

export interface RepairOrderStatusNameRecord {
  id: string;
  crm_status_id: string;
  crm_sort_order: number;
  crm_name_uz: string;
  crm_name_ru: string;
  crm_name_en: string;
  display_name_uz: string | null;
  display_name_ru: string | null;
  created_at?: string;
  updated_at?: string;
}

export type RepairOrderStatusNameUpdate = Pick<
  RepairOrderStatusNameRecord,
  'display_name_uz' | 'display_name_ru'
>;
