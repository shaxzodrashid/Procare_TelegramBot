export const CUSTOMER_REPAIR_STATUS_CODES = [
  'NEW',
  'DIAGNOSIS',
  'AWAITING_APPROVAL',
  'IN_REPAIR',
  'WAITING_FOR_PARTS',
  'TESTING',
  'READY',
  'OUT_FOR_DELIVERY',
  'COMPLETED',
  'CANCELLED',
  'MISSED',
  'UNREPAIRABLE',
  'INVALID',
] as const;

export type CustomerRepairStatusCode = (typeof CUSTOMER_REPAIR_STATUS_CODES)[number];
export type CustomerRepairProgressType = 'linear' | 'terminal';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'overpaid';

export interface LocalizedCustomerText {
  name_uz: string | null;
  name_ru: string | null;
  name_en: string | null;
}

export interface LocalizedCustomerSummary {
  uz: string | null;
  ru: string | null;
  en: string | null;
}

export interface CustomerRepairStatus extends LocalizedCustomerText {
  code: CustomerRepairStatusCode;
  customer_message_uz?: string | null;
  customer_message_ru?: string | null;
  customer_message_en?: string | null;
  progress_type: CustomerRepairProgressType;
  step: number | null;
  total_steps: number | null;
  updated_at: string;
}

export interface CustomerRepairDevice {
  brand: string | null;
  model: string | null;
}

export interface CustomerRepairListPricing {
  currency: string;
  final_total: string | null;
  payment_status: PaymentStatus;
}

export interface CustomerRepairOrderListItem {
  order_number: string;
  device: CustomerRepairDevice;
  status: CustomerRepairStatus;
  created_at: string;
  estimated_ready_at: string | null;
  pricing: CustomerRepairListPricing;
}

export interface RepairOrderPagination {
  limit: number;
  offset: number;
  total: number;
  has_more: boolean;
}

export interface CustomerRepairOrderList {
  orders: CustomerRepairOrderListItem[];
  pagination: RepairOrderPagination;
}

export interface CustomerRepairPayment {
  amount: string;
  currency: string;
  paid_at: string;
  method: string;
}

export interface CustomerRepairPricingDetail extends CustomerRepairListPricing {
  estimated_total: string | null;
  paid_amount: string;
  remaining_amount: string;
  payments: CustomerRepairPayment[];
}

export interface CustomerRepairBranch extends LocalizedCustomerText {
  address_uz: string | null;
  address_ru: string | null;
  address_en: string | null;
  telephone: string | null;
  working_hours: {
    start: string | null;
    end: string | null;
  };
  map_url: string | null;
}

export interface CustomerRepairWarranty {
  period_months: number | null;
  warranty_until: string | null;
}

export interface CustomerRepairStatusHistoryItem extends LocalizedCustomerText {
  code: CustomerRepairStatusCode;
  progress_type: CustomerRepairProgressType;
  step: number | null;
  total_steps: number | null;
  changed_at: string;
}

export interface CustomerRepairOrderDetail extends CustomerRepairOrderListItem {
  updated_at: string;
  device: CustomerRepairDevice & {
    imei_last4: string | null;
  };
  status: Required<CustomerRepairStatus>;
  problem_summary: LocalizedCustomerSummary;
  service_summary: LocalizedCustomerSummary;
  pricing: CustomerRepairPricingDetail;
  branch: CustomerRepairBranch;
  completed_at: string | null;
  picked_up_at: string | null;
  warranty: CustomerRepairWarranty;
  status_history: CustomerRepairStatusHistoryItem[];
}
