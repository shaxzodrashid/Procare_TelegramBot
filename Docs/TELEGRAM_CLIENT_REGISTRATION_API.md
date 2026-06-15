# Telegram Client Registration API

## Purpose

The Telegram bot uses this endpoint after receiving a user's shared phone number. The API resolves
an existing active CRM client and returns the complete client profile available to this integration,
including all non-deleted repair orders.

This operation does **not** create a CRM client. An unknown, inactive, banned, pending, or deleted
client returns `404 Not Found`.

## Endpoint

```http
POST /api/v1/users/register-client
Content-Type: application/json
Authorization: Basic <base64(username:password)>
```

Full local example:

```http
POST http://localhost:5001/api/v1/users/register-client
```

## Authentication

Use the shared Telegram bot HTTP Basic Auth credentials configured on the API server:

| Setting                            | Purpose              |
| ---------------------------------- | -------------------- |
| `TELEGRAM_BOT_BASIC_AUTH_USER`     | Bot service username |
| `TELEGRAM_BOT_BASIC_AUTH_PASSWORD` | Bot service password |

These credentials authenticate the bot service, not the Telegram user.

Example:

```bash
curl --request POST "http://localhost:5001/api/v1/users/register-client" \
  --user "$TELEGRAM_BOT_BASIC_AUTH_USER:$TELEGRAM_BOT_BASIC_AUTH_PASSWORD" \
  --header "Content-Type: application/json" \
  --data '{"phone_number":"90 123 45 67"}'
```

## Request

```json
{
  "phone_number": "+998901234567"
}
```

`phone_number` is required. No additional body properties are accepted.

Accepted equivalent formats:

| Input            | Normalized lookup value |
| ---------------- | ----------------------- |
| `+998901234567`  | `+998901234567`         |
| `998901234567`   | `+998901234567`         |
| `901234567`      | `+998901234567`         |
| `90 123 45 67`   | `+998901234567`         |
| `(90) 123-45-67` | `+998901234567`         |

The lookup checks both `users.phone_number1` and `users.phone_number2`. Only clients with
`status = Open` and `is_active = true` are eligible.

## Response Summary

| HTTP status | Meaning                                                 | Bot action                                       |
| ----------- | ------------------------------------------------------- | ------------------------------------------------ |
| `200`       | Client found, with zero or more repair orders           | Save/use the returned client and order data      |
| `400`       | Invalid request body or phone number                    | Ask the user to share a valid Uzbek phone        |
| `401`       | Missing, malformed, invalid, or unconfigured Basic Auth | Do not retry until service credentials are fixed |
| `404`       | No active open client matches either stored phone field | Start the bot's unknown-client flow              |
| `500`       | Unexpected API or database failure                      | Log and retry according to bot retry policy      |
| `503`       | CRM API is in maintenance mode                          | Show maintenance notice and retry later          |

Except for `503`, errors use this envelope:

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

## 200 OK

### Maximum populated response

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "customer_code": "C-1001",
  "first_name": "Ali",
  "last_name": "Valiyev",
  "phone_number1": "+998901234567",
  "phone_number2": "+998911234567",
  "phone_verified": true,
  "passport_series": "AA1234567",
  "birth_date": "1995-04-12",
  "id_card_number": "AD1234567",
  "language": "uz",
  "telegram_chat_id": "123456789",
  "telegram_username": "ali_valiyev",
  "source": "employee",
  "status": "Open",
  "is_active": true,
  "created_at": "2026-01-10T08:30:00.000Z",
  "updated_at": "2026-06-15T09:45:00.000Z",
  "created_by": "22222222-2222-4222-8222-222222222222",
  "repair_orders": [
    {
      "id": "33333333-3333-4333-8333-333333333333",
      "total": "350000.00",
      "imei": "356789012345678",
      "delivery_method": "Self",
      "pickup_method": "Pickup",
      "priority": "High",
      "status": "Open",
      "call_count": 2,
      "created_at": "2026-06-14T11:20:00.000Z",
      "description": "Display replacement and diagnostics",
      "branch": {
        "id": "44444444-4444-4444-8444-444444444444",
        "name_uz": "Chilonzor filiali",
        "name_ru": "Чиланзарский филиал",
        "name_en": "Chilanzar branch"
      },
      "phone_category": {
        "id": "55555555-5555-4555-8555-555555555555",
        "name_uz": "iPhone 14 Pro",
        "name_ru": "iPhone 14 Pro",
        "name_en": "iPhone 14 Pro"
      },
      "repair_order_status": {
        "id": "66666666-6666-4666-8666-666666666666",
        "name_uz": "Ta'mirlashda",
        "name_ru": "В ремонте",
        "name_en": "In repair",
        "color": "#16A34A",
        "bg_color": "#DCFCE7"
      }
    }
  ]
}
```

### Client without repair orders

`repair_orders` is always present. It is an empty array when no matching orders exist:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "customer_code": null,
  "first_name": "Ali",
  "last_name": "Valiyev",
  "phone_number1": "+998901234567",
  "phone_number2": null,
  "phone_verified": false,
  "passport_series": null,
  "birth_date": null,
  "id_card_number": null,
  "language": "uz",
  "telegram_chat_id": null,
  "telegram_username": null,
  "source": "other",
  "status": "Open",
  "is_active": true,
  "created_at": "2026-06-15T08:30:00.000Z",
  "updated_at": "2026-06-15T08:30:00.000Z",
  "created_by": null,
  "repair_orders": []
}
```

### Success field rules

- `total` is a decimal string, not a JSON number.
- `telegram_chat_id` is a string when present.
- Nullable client fields can be `null`.
- Joined `branch`, `phone_category`, and `repair_order_status` properties are always objects, but
  their individual fields can be `null` if referenced data is unavailable.
- Repair orders are sorted newest first by `created_at`.
- Orders with `status = Deleted` are excluded. `Open`, `Closed`, and `Cancelled` orders can appear.

## 400 Bad Request

### Missing, empty, non-string, or invalid phone number

```json
{
  "statusCode": 400,
  "message": "Invalid phone number format",
  "error": "ValidationError",
  "location": "phone_number",
  "timestamp": "2026-06-15T10:00:00.000Z",
  "path": "/api/v1/users/register-client"
}
```

Examples that produce this response include `{}`, `{"phone_number": ""}`,
`{"phone_number": "123"}`, and `{"phone_number": 123}`.

### Unsupported body property

Request:

```json
{
  "phone_number": "+998901234567",
  "extra": true
}
```

Response:

```json
{
  "statusCode": 400,
  "message": "Property extra should not exist",
  "error": "ValidationError",
  "location": "extra",
  "timestamp": "2026-06-15T10:00:00.000Z",
  "path": "/api/v1/users/register-client"
}
```

## 401 Unauthorized

### Missing or non-Basic Authorization header

```json
{
  "statusCode": 401,
  "message": "Unauthorized: Missing or invalid basic authorization credentials",
  "error": "UnauthorizedException",
  "location": "basic_auth_header",
  "timestamp": "2026-06-15T10:00:00.000Z",
  "path": "/api/v1/users/register-client"
}
```

### Malformed Basic credentials

The decoded Basic Auth value does not contain the required `username:password` separator.

```json
{
  "statusCode": 401,
  "message": "Unauthorized: Invalid credentials format",
  "error": "UnauthorizedException",
  "location": "basic_auth_format",
  "timestamp": "2026-06-15T10:00:00.000Z",
  "path": "/api/v1/users/register-client"
}
```

### Incorrect username or password

```json
{
  "statusCode": 401,
  "message": "Unauthorized: Invalid login or password",
  "error": "UnauthorizedException",
  "location": "basic_auth_credentials",
  "timestamp": "2026-06-15T10:00:00.000Z",
  "path": "/api/v1/users/register-client"
}
```

### Server credentials are not configured

```json
{
  "statusCode": 401,
  "message": "Unauthorized: Telegram bot Basic Auth is not configured on server",
  "error": "UnauthorizedException",
  "location": "basic_auth_config",
  "timestamp": "2026-06-15T10:00:00.000Z",
  "path": "/api/v1/users/register-client"
}
```

## 404 Not Found

This response covers all of these cases:

- no client has the supplied phone in `phone_number1` or `phone_number2`;
- the matching client has `is_active = false`;
- the matching client status is `Pending`, `Banned`, or `Deleted`;
- the client becomes unavailable between lookup and response construction.

```json
{
  "statusCode": 404,
  "message": "User not found",
  "error": "NotFound",
  "location": "phone_number",
  "timestamp": "2026-06-15T10:00:00.000Z",
  "path": "/api/v1/users/register-client"
}
```

In the rare last case, the location can instead be `user_not_found`.

## 500 Internal Server Error

Unexpected application or database failures use the standard error envelope:

```json
{
  "statusCode": 500,
  "message": "Unexpected error",
  "error": "InternalServerError",
  "location": null,
  "timestamp": "2026-06-15T10:00:00.000Z",
  "path": "/api/v1/users/register-client"
}
```

PostgreSQL failures can provide a more specific `message`, `error`, and `location`.

## 503 Service Unavailable

Maintenance mode is handled before the controller and returns a smaller response:

```json
{
  "message": "🛠 Texnik ishlar ketmoqda. Iltimos, keyinroq urinib ko‘ring.",
  "location": "maintenance_mode"
}
```

## Bot Integration Notes

- Treat the HTTP status as the primary result discriminator.
- Do not infer success from the presence of `message`; maintenance and errors also contain it.
- Do not retry `400`, `401`, or `404` automatically.
- Retry `500` and `503` only with bounded backoff.
- Never log the Basic Auth password or complete `Authorization` header.
- The endpoint is idempotent and read-only; repeated valid requests return current CRM data.
