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
export type CustomerAssignedAdminRoleType =
  | 'SuperAdmin'
  | 'Operator'
  | 'Specialist'
  | 'Master'
  | 'Courier';
export type CustomerRepairProblemWorkflowStatus =
  | 'not_started'
  | 'in_progress'
  | 'paused'
  | 'finished'
  | 'legacy_finished';

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

export interface CustomerRepairDocuments {
  checklist_url: string | null;
  warranty_document_url: string | null;
  offer_url: string | null;
}

export interface CustomerRepairStatusHistoryItem extends LocalizedCustomerText {
  code: string;
  progress_type: string;
  step: number | null;
  total_steps: number | null;
  changed_at: string;
}

export interface CustomerAssignedAdminRole {
  id: string;
  name: string;
  type: CustomerAssignedAdminRoleType | null;
}

export interface CustomerAssignedAdmin {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  roles: CustomerAssignedAdminRole[];
}

export interface CustomerRepairProblemPart {
  id: string;
  repair_part_id: string;
  part_name_uz: string;
  part_name_ru: string;
  part_name_en: string | null;
  quantity: number;
  part_price: string;
}

export interface CustomerRepairFinalProblem extends LocalizedCustomerText {
  id: string;
  problem_category_id: string;
  name_uz: string;
  name_ru: string;
  name_en: string;
  price: string;
  estimated_minutes: number;
  is_done: boolean;
  workflow_status: CustomerRepairProblemWorkflowStatus | null;
  parts: CustomerRepairProblemPart[];
}

export interface CustomerRepairOrderDetail extends CustomerRepairOrderListItem {
  id: string;
  updated_at: string;
  assigned_admins: CustomerAssignedAdmin[];
  final_problems?: CustomerRepairFinalProblem[];
  device: CustomerRepairDevice & {
    imei_last4: string | null;
  };
  status: Required<CustomerRepairStatus>;
  problem_summary?: LocalizedCustomerSummary;
  service_summary?: LocalizedCustomerSummary;
  pricing: CustomerRepairPricingDetail;
  branch: CustomerRepairBranch;
  completed_at: string | null;
  picked_up_at: string | null;
  warranty: CustomerRepairWarranty;
  documents: CustomerRepairDocuments;
  status_history: CustomerRepairStatusHistoryItem[];
}

export type CustomerSupportReplyTargetType = 'comment' | 'history' | 'audio';

export interface CustomerSupportCommentAuthor {
  id: string;
  display_name: string | null;
  phone_number?: string | null;
  username?: string | null;
}

export interface CustomerSupportCommentReply {
  target_type: CustomerSupportReplyTargetType;
  target_id: string;
  snapshot: Record<string, unknown>;
}

export interface CustomerSupportCommentPhoto {
  id: string;
  original_name: string;
  mime_type: string;
  urls: {
    small: string;
    medium: string;
    large: string;
  };
}

export interface CustomerSupportComment {
  item_type: 'message';
  id: string;
  comment_type: 'support';
  author_type: 'user';
  direction: 'inbound';
  text: string | null;
  author: CustomerSupportCommentAuthor;
  reply: CustomerSupportCommentReply | null;
  photos: CustomerSupportCommentPhoto[];
  is_editable: boolean;
  is_deletable: boolean;
  is_edited: boolean;
  is_read: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerSupportCommentResponse {
  comment: CustomerSupportComment;
  created: boolean;
}

export const CUSTOMER_SUPPORT_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type CustomerSupportPhotoMimeType = (typeof CUSTOMER_SUPPORT_PHOTO_MIME_TYPES)[number];

export interface CustomerSupportPhotoUpload {
  fileName: string;
  mimeType: CustomerSupportPhotoMimeType;
  data: Uint8Array;
}

export interface CustomerSupportCommentRequest {
  text?: string;
  replyTargetType?: CustomerSupportReplyTargetType;
  replyTargetId?: string;
  photos?: CustomerSupportPhotoUpload[];
}
