# Telegram Client Repair Orders API

All endpoints are called by the trusted Telegram bot backend and require:

```http
Authorization: Basic <telegram bot service credentials>
```

`client_id` identifies the requested client. It is not an authentication credential.
The API controller is guarded by `TelegramBotBasicAuthGuard`.

## Registration

```http
POST /api/v1/users/register-client
```

```json
{
  "phone_number": "+998901234567"
}
```

Client response:

```json
{
  "account_type": "client",
  "client_id": "11111111-1111-4111-8111-111111111111",
  "first_name": "Ali",
  "last_name": "Valiyev",
  "language": "uz",
  "has_repair_orders": true,
  "is_admin": false,
  "admin": null
}
```

`has_repair_orders` is a point-in-time hint. It must not suppress future list requests.
Registration never returns repair-order objects.

## List repair orders

```http
GET /api/v1/telegram/clients/:client_id/repair-orders?limit=10&offset=0
```

- `limit`: 1–50, default 10
- `offset`: minimum 0, default 0
- Sort: `created_at DESC, id DESC`
- Apply client ownership, branch visibility, status visibility, and explicit customer-status mapping
  before pagination and total calculation.

```json
{
  "orders": [
    {
      "order_number": "1024",
      "device": {
        "brand": "Apple",
        "model": "iPhone 14 Pro"
      },
      "status": {
        "code": "IN_REPAIR",
        "name_uz": "Ta’mirlash jarayoni",
        "name_ru": "В процессе ремонта",
        "name_en": "In Repair",
        "progress_type": "linear",
        "step": 4,
        "total_steps": 7,
        "updated_at": "2026-06-18T10:00:00.000Z"
      },
      "created_at": "2026-06-14T11:20:00.000Z",
      "estimated_ready_at": null,
      "pricing": {
        "currency": "UZS",
        "final_total": "350000",
        "payment_status": "partial"
      }
    }
  ],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "total": 1,
    "has_more": false
  }
}
```

## Repair order detail

```http
GET /api/v1/telegram/clients/:client_id/repair-orders/:order_number
```

The detail response adds:

- Repair-order UUID as `id`, used by the support-comment endpoint
- Active assigned admins with active role specs
- Finalized repair problems as `final_problems[]`, including per-problem warranty periods and
  nested assigned repair parts
- Customer-facing status messages
- Last four IMEI digits
- Estimated, final, paid, and remaining totals
- Customer-safe payment rows
- Branch address, telephone, working hours, and map URL
- Completion and pickup timestamps
- Legacy order-level warranty expiry metadata
- Optional checklist, warranty-document, and offer URLs
- Customer-visible status history

Unavailable optional values are returned as `null`. Arrays are returned as empty arrays.

Example:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "order_number": "1024",
  "assigned_admins": [
    {
      "id": "33333333-3333-4333-8333-333333333333",
      "first_name": "John",
      "last_name": "Doe",
      "phone_number": "+998901234567",
      "roles": [
        {
          "id": "44444444-4444-4444-8444-444444444444",
          "name": "Master",
          "type": "Master"
        }
      ]
    }
  ],
  "final_problems": [
    {
      "id": "55555555-5555-4555-8555-555555555555",
      "problem_category_id": "66666666-6666-4666-8666-666666666666",
      "name_uz": "Displey almashtirish",
      "name_ru": "Замена дисплея",
      "name_en": "Display replacement",
      "warranty_period": 6,
      "price": "250000",
      "estimated_minutes": 45,
      "is_done": true,
      "workflow_status": "finished",
      "parts": [
        {
          "id": "77777777-7777-4777-8777-777777777777",
          "repair_part_id": "88888888-8888-4888-8888-888888888888",
          "part_name_uz": "OLED ekran",
          "part_name_ru": "OLED экран",
          "part_name_en": "OLED screen",
          "quantity": 1,
          "part_price": "100000"
        }
      ]
    }
  ],
  "device": {
    "brand": "Apple",
    "model": "iPhone 14 Pro",
    "imei_last4": "5678"
  },
  "status": {
    "code": "IN_REPAIR",
    "name_uz": "Ta’mirlash jarayoni",
    "name_ru": "В процессе ремонта",
    "name_en": "In Repair",
    "customer_message_uz": "Qurilmangiz ta’mirlanmoqda",
    "customer_message_ru": "Ваше устройство ремонтируется",
    "customer_message_en": "Your device is being repaired",
    "progress_type": "linear",
    "step": 4,
    "total_steps": 7,
    "updated_at": "2026-06-18T10:00:00.000Z"
  },
  "created_at": "2026-06-14T11:20:00.000Z",
  "estimated_ready_at": null,
  "updated_at": "2026-06-18T10:00:00.000Z",
  "pricing": {
    "currency": "UZS",
    "estimated_total": null,
    "final_total": "350000.00",
    "paid_amount": "100000.00",
    "remaining_amount": "250000.00",
    "payment_status": "partial",
    "payments": [
      {
        "amount": "100000.00",
        "currency": "UZS",
        "paid_at": "2026-06-16T09:00:00.000Z",
        "method": "card"
      }
    ]
  },
  "branch": {
    "name_uz": "Chilonzor filiali",
    "name_ru": "Чиланзарский филиал",
    "name_en": "Chilanzar branch",
    "address_uz": "Bunyodkor ko‘chasi, 12",
    "address_ru": "ул. Бунёдкор, 12",
    "address_en": "12 Bunyodkor Street",
    "telephone": "+998712000000",
    "working_hours": {
      "start": "09:00",
      "end": "20:00"
    },
    "map_url": "https://maps.example.com/branch"
  },
  "completed_at": null,
  "picked_up_at": null,
  "warranty": {
    "period_months": 3,
    "warranty_until": null
  },
  "documents": {
    "checklist_url": "https://crm.procare.uz/documents/checklist/1024",
    "warranty_document_url": null,
    "offer_url": "https://crm.procare.uz/documents/offer/1024"
  },
  "status_history": [
    {
      "code": "DIAGNOSIS",
      "name_uz": "Diagnostika",
      "name_ru": "Диагностика",
      "name_en": "Diagnosis",
      "progress_type": "linear",
      "step": 2,
      "total_steps": 7,
      "changed_at": "2026-06-15T08:00:00.000Z"
    }
  ]
}
```

`payment_status` is one of `unpaid`, `partial`, `paid`, or `overpaid`.

`final_problems` is always an array. Each item is a customer-safe finalized repair problem with
localized names, `warranty_period`, `price`, `estimated_minutes`, `is_done`, `workflow_status`, and
`parts[]`. `warranty_period` is the problem category's customer-visible warranty period in months;
if the problem category has no configured warranty, the API returns `0`.
`workflow_status` is one of `not_started`, `in_progress`, `paused`, `finished`,
`legacy_finished`, or `null`. `parts[]` is an empty array when no repair parts are attached. Each
part contains `id`, `repair_part_id`, localized part names, `quantity`, and `part_price`.
The bot treats a missing `final_problems` field as an empty array for compatibility with staged CRM
rollouts, but new CRM responses should send `[]` when no final problems exist.

The bot renders warranty periods from `final_problems[].warranty_period` whenever finalized problems
are present. The top-level `warranty` object remains accepted for compatibility and for order-level
expiry metadata such as `warranty_until`, but it is no longer the primary source for per-repair
warranty copy.

`assigned_admins` includes only active, open admins assigned to the repair order. Each admin includes
active, open role specs as `roles[]` with `id`, `name`, and `type`. `type` is one of `SuperAdmin`,
`Operator`, `Specialist`, `Master`, `Courier`, or `null` for a custom role without a canonical type.

## Register client support comment

```http
POST /api/v1/repair-orders/register-comment/:repair_order_id
Content-Type: multipart/form-data
```

The trusted bot service uses the repair-order UUID from the detail response. Public order numbers
must not be used as the path value.

Multipart fields:

- `text`: optional trimmed message, maximum 4000 characters
- `photos`: optional, up to 5 JPEG, PNG, or WebP images, maximum 5 MB each
- `reply_target_type`: optional, one of `comment`, `history`, or `audio`; must be sent with
  `reply_target_id`
- `reply_target_id`: optional UUID; must be sent with `reply_target_type`

Either `text` or at least one photo is required. The bot must not automatically retry this POST.
The backend deduplicates identical successful submissions within 60 seconds and returns
`"created": false` for a duplicate request.

Success response:

```json
{
  "comment": {
    "item_type": "message",
    "id": "22222222-2222-4222-8222-222222222222",
    "comment_type": "support",
    "author_type": "user",
    "direction": "inbound",
    "text": "Support message text from client",
    "author": {
      "id": "33333333-3333-4333-8333-333333333333",
      "display_name": "Ali Valiyev",
      "phone_number": "+998901234567"
    },
    "reply": null,
    "photos": [],
    "is_editable": false,
    "is_deletable": false,
    "is_edited": false,
    "is_read": false,
    "created_at": "2026-06-24T07:14:04.000Z",
    "updated_at": "2026-06-24T07:14:04.000Z"
  },
  "created": true
}
```

## Status behavior

Supported stable status codes:

```text
NEW
DIAGNOSIS
AWAITING_APPROVAL
IN_REPAIR
WAITING_FOR_PARTS
TESTING
READY
OUT_FOR_DELIVERY
COMPLETED
CANCELLED
MISSED
UNREPAIRABLE
INVALID
```

Terminal statuses use:

```json
{
  "code": "UNREPAIRABLE",
  "progress_type": "terminal",
  "step": null,
  "total_steps": null
}
```

Linear statuses require integer `step >= 1` and `total_steps >= step`. Terminal statuses require
both values to be `null`. Progress is supplied by an explicit customer mapping and is never derived
from the internal status sort order.

## Privacy and errors

The detail endpoint returns the same `404` response when an order:

- Does not exist
- Belongs to another client
- Is deleted
- Has a hidden or inactive branch
- Has a hidden or inactive status
- Does not have an explicit customer status mapping

The list endpoint applies the same visibility rules and does not include those orders in `orders` or
`pagination.total`.

Responses are built from a customer-safe allowlist. Full IMEI, internal notes, raw descriptions,
unassigned employee data, call counts, cost prices, margins, and unrelated internal identifiers are
not returned.

Money values are strings. Timestamps are ISO 8601 UTC.

The bot exposes each non-null document URL as a separate inline keyboard button. It does not create
buttons for missing document URLs.

## Errors

| HTTP status | Meaning |
| --- | --- |
| `400` | Invalid client/order parameter or pagination |
| `401` | Missing, invalid, or unconfigured Telegram Bot Basic Auth |
| `404` | Client/order is absent, foreign, deleted, hidden, inactive, or unmapped |
| `500` | Unexpected API or database failure |
| `503` | CRM API is in maintenance mode |

Except for the platform maintenance response, errors use the same structured error envelope as the
registration endpoint.
