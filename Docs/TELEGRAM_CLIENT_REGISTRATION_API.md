# Telegram Client Registration API

## Purpose

The Telegram bot uses this endpoint after receiving a user's shared phone number. The endpoint
resolves an active CRM client or administrator and returns only the identity data required to start
the correct bot session.

Registration does not create a CRM client and never returns repair-order objects, passport data,
identity-card data, full CRM profiles, or other customer-sensitive fields.

Repair orders are loaded separately through
`Docs/TELEGRAM_CLIENT_REPAIR_ORDERS_API.md`.

## Endpoint

```http
POST /api/v1/users/register-client
Content-Type: application/json
Authorization: Basic <base64(username:password)>
```

The Basic Auth credentials authenticate the trusted Telegram bot service, not the Telegram user.

## Request

```json
{
  "phone_number": "+998901234567"
}
```

`phone_number` is required and no additional body properties are accepted. The API normalizes the
documented Uzbek formats before lookup.

The lookup checks the CRM client's primary and secondary phone numbers. Only clients with
`status = Open` and `is_active = true` are eligible. The same normalized phone candidates are
checked against active/open administrators.

## Client response

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

`first_name`, `last_name`, and `language` may be `null`.

`has_repair_orders` is a point-in-time hint only. The bot must still call the dedicated list
endpoint whenever the user opens “My orders.”

## Client response with matching administrator

```json
{
  "account_type": "client",
  "client_id": "11111111-1111-4111-8111-111111111111",
  "first_name": "Ali",
  "last_name": "Valiyev",
  "language": "uz",
  "has_repair_orders": true,
  "is_admin": true,
  "admin": {
    "id": "77777777-7777-4777-8777-777777777777",
    "first_name": "Ali",
    "last_name": "Valiyev",
    "phone_number": "+998901234567",
    "phone_verified": true,
    "language": "uz",
    "status": "Open",
    "is_active": true,
    "created_at": "2026-01-08T08:30:00.000Z",
    "updated_at": "2026-06-15T09:45:00.000Z"
  }
}
```

The current bot treats any successful response with `is_admin = true` as an employee-only session.

## Administrator-only response

When no active/open client matches but an active/open administrator does:

```json
{
  "account_type": "admin",
  "is_admin": true,
  "admin": {
    "id": "77777777-7777-4777-8777-777777777777",
    "first_name": "Ali",
    "last_name": "Valiyev",
    "phone_number": "+998901234567",
    "phone_verified": true,
    "language": "uz",
    "status": "Open",
    "is_active": true,
    "created_at": "2026-01-08T08:30:00.000Z",
    "updated_at": "2026-06-15T09:45:00.000Z"
  }
}
```

## Response summary

| HTTP status | Meaning | Bot action |
| --- | --- | --- |
| `200` | Active client or administrator found | Select client/employee flow |
| `400` | Invalid request body or phone number | Ask for a valid Uzbek number |
| `401` | Missing, malformed, invalid, or unconfigured Basic Auth | Do not retry until credentials are fixed |
| `404` | No active/open client or administrator matched | Start unknown-client flow |
| `500` | Unexpected API or database failure | Treat as temporarily unavailable |
| `503` | CRM API is in maintenance mode | Show maintenance message and retry later |

Except for the platform maintenance response, errors use:

```json
{
  "statusCode": 400,
  "message": "Human-readable message",
  "error": "Machine-readable error category",
  "location": "field_or_failure_location",
  "timestamp": "2026-06-15T10:00:00.000Z",
  "path": "/api/v1/users/register-client"
}
```

## Privacy requirements

- Build the response from an explicit allowlist.
- Do not return repair orders or use registration as an order cache.
- Do not return passport, ID-card, birth-date, Telegram chat, or CRM-internal fields.
- Never log the Basic Auth password, authorization header, or complete phone number.
- Keep administrator data limited to the fields required by the bot's employee session.
