# Repair Order Status Catalog API

Source: Postman workspace `Procare_TelegramBot`, collection `CRM APIs`, request
`Get Repair Order Statuses`.

This endpoint returns the active repair-order status catalog used by the Telegram bot.

## Request

```http
GET /api/v1/external/repair-order-statuses
Authorization: Basic <telegram bot service credentials>
Accept: application/json
```

The endpoint is branchless. Do not send `branch_id`, `limit`, or `offset`.

## Success Response

`200 OK` returns a JSON array. Each array item contains only these fields:

```json
[
  {
    "id": "50000000-0000-0000-0001-001000000000",
    "name_uz": "Yangi buyurtma",
    "name_ru": "Новый заказ",
    "name_en": "New Order"
  }
]
```

The response must not include pagination metadata, permissions, transitions, metrics, colors,
branch data, or other repair-order status fields.

## Error Responses

`401 Unauthorized` is returned when Telegram bot Basic Auth credentials are missing or invalid.
The error envelope includes a `message` and a `location` such as `basic_auth_header` or
`basic_auth_credentials`.

## Telegram Bot Implementation Notes

- The local client must call the endpoint without query parameters.
- The runtime validator accepts only the plain array response shape.
- The local `repair_order_status_names` table stores the CRM status ID, CRM response order, and
  CRM names plus employee-managed Uzbek/Russian display names.
- Refreshing from CRM updates CRM-owned names and keeps employee-managed display names unchanged.
