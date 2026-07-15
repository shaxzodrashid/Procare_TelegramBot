# Telegram Repair-Order Ratings API

## Purpose

This endpoint records the current customer satisfaction rating for a repair order submitted through the Telegram bot. It is intentionally service-authenticated: the Telegram bot calls the CRM after a customer selects a grade and optionally enters feedback.

The first supported source is `Telegram`. The storage model is source-aware, so future customer channels can record their own rating without overwriting the Telegram rating.

## Endpoint

```http
POST /api/v1/telegram/repair-orders/rating?repair_order_id=<repair-order-uuid>
Authorization: Basic <base64(TELEGRAM_BOT_BASIC_AUTH_USER:TELEGRAM_BOT_BASIC_AUTH_PASSWORD)>
Content-Type: application/json
```

| Item                    | Value                                                            |
| ----------------------- | ---------------------------------------------------------------- |
| Method                  | `POST`                                                           |
| Success status          | `200 OK`                                                         |
| Authentication          | HTTP Basic Auth using the Telegram bot service credentials       |
| Request content type    | `application/json`                                               |
| Rate source             | Always set by the server to `Telegram`                           |
| Repair-order identifier | `repair_order_id` query parameter; UUID v4 of `repair_orders.id` |

This is not an admin Bearer-token endpoint and is not public. Do not send an admin JWT, a customer phone number, a Telegram chat ID, or a client ID to this API.

## Authentication

The caller must send the configured Telegram service credentials:

```text
TELEGRAM_BOT_BASIC_AUTH_USER
TELEGRAM_BOT_BASIC_AUTH_PASSWORD
```

Example:

```http
Authorization: Basic Ym90OnNlY3JldA==
```

The example encodes `bot:secret`; it is illustrative only. Never place real credentials in source code, messages, client-side Telegram callbacks, or logs.

## Request contract

### Query parameters

| Parameter         | Required | Type    | Rules                                                                   |
| ----------------- | -------- | ------- | ----------------------------------------------------------------------- |
| `repair_order_id` | Yes      | UUID v4 | Must identify an existing repair order whose `status` is not `Deleted`. |

The value is the internal repair-order UUID, not the human-visible `number_id` such as `1024`.

### JSON body

| Field   | Required | Type    | Rules                                                                                                                                    |
| ------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `grade` | Yes      | integer | Customer grade from `1` (lowest) through `5` (highest).                                                                                  |
| `notes` | No       | string  | Customer feedback, maximum 2,000 characters. Leading/trailing whitespace is removed. Empty or whitespace-only input is stored as `null`. |

Only `grade` and `notes` are accepted. Unknown body fields, including `source`, `customer_id`, and `repair_order_id`, are rejected with `400 Bad Request`.

### Minimal request

```json
{
  "grade": 5
}
```

### Request with feedback

```json
{
  "grade": 4,
  "notes": "Fast service. Please keep customers updated about the repair progress."
}
```

### cURL example

```bash
curl --request POST \
  --url 'https://crm-api.procare.uz/api/v1/telegram/repair-orders/rating?repair_order_id=550e8400-e29b-41d4-a716-446655440000' \
  --user "$TELEGRAM_BOT_BASIC_AUTH_USER:$TELEGRAM_BOT_BASIC_AUTH_PASSWORD" \
  --header 'Content-Type: application/json' \
  --data '{
    "grade": 5,
    "notes": "Fast and careful service. Thank you!"
  }'
```

## Success response

The endpoint returns the persisted current Telegram rating.

```json
{
  "id": "8aafdb4b-28dc-4e8f-9cbe-b584e2f7f3e9",
  "repair_order_id": "550e8400-e29b-41d4-a716-446655440000",
  "source": "Telegram",
  "grade": 5,
  "notes": "Fast and careful service. Thank you!",
  "created_at": "2026-07-14T08:00:00.000Z",
  "updated_at": "2026-07-14T08:00:00.000Z"
}
```

| Field             | Meaning                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| `id`              | Internal UUID of this source-specific rating record.                       |
| `repair_order_id` | Internal UUID of the rated repair order.                                   |
| `source`          | The trusted server-side source. For this endpoint it is always `Telegram`. |
| `grade`           | Persisted integer grade from 1 through 5.                                  |
| `notes`           | Trimmed feedback text, or `null` when it was omitted or blank.             |
| `created_at`      | When the Telegram rating was first recorded.                               |
| `updated_at`      | When the Telegram rating was most recently submitted or changed.           |

## Idempotency and updates

There is exactly one current rating for each `(repair_order_id, source)` pair.

| Situation                                      | Result                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| First Telegram submission for an order         | Creates the Telegram rating and returns `200`.                                                       |
| Telegram retry with the same payload           | Succeeds with `200`; it does not create a duplicate rating.                                          |
| Customer changes their Telegram grade or notes | Updates that order's Telegram rating and returns `200`.                                              |
| A future source rates the same order           | It must use its own server-controlled source integration; it must not overwrite the Telegram rating. |

On an update, `id` and `created_at` remain associated with the original Telegram rating. `grade`, `notes`, and `updated_at` reflect the latest submission.

The endpoint does not store a history of previous Telegram grades. Reporting should treat this table as the current rating per source, not as an event log.

## Error responses

All errors use the standard API envelope. `timestamp` is generated by the server and `path` is the requested path.

```json
{
  "statusCode": 400,
  "message": "Grade must not be greater than 5",
  "error": "ValidationError",
  "location": "grade",
  "timestamp": "2026-07-14T08:00:00.000Z",
  "path": "/api/v1/telegram/repair-orders/rating?repair_order_id=550e8400-e29b-41d4-a716-446655440000"
}
```

| Status | `location`                 | When it happens                                                           | Caller action                                                                       |
| ------ | -------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `400`  | `repair_order_id`          | The query value is absent or not a UUID v4.                               | Send the internal UUID returned/held by the repair-order flow, not an order number. |
| `400`  | `grade`                    | `grade` is missing, not an integer, less than 1, or greater than 5.       | Send one integer from 1 through 5.                                                  |
| `400`  | `notes`                    | `notes` is not a string or exceeds 2,000 characters.                      | Send a shorter string, or omit the field.                                           |
| `400`  | Name of the extra property | The JSON body includes a field other than `grade` or `notes`.             | Remove the unknown field.                                                           |
| `401`  | `basic_auth_header`        | The Authorization header is missing or does not use Basic authentication. | Send the Telegram service Basic Auth header.                                        |
| `401`  | `basic_auth_format`        | The Basic Auth value cannot be parsed as `username:password`.             | Rebuild the header through the HTTP client rather than manually assembling it.      |
| `401`  | `basic_auth_credentials`   | The Telegram service credentials are invalid.                             | Check the configured bot username/password.                                         |
| `401`  | `basic_auth_config`        | The server has no configured Telegram service credentials.                | Fix server environment configuration; the bot cannot resolve this itself.           |
| `404`  | `repair_order_id`          | No matching repair order exists, or the matching order is soft-deleted.   | Do not retry blindly; refresh the bot's repair-order state.                         |

Validation error messages can vary by failed validator, so bot UX should route errors by `location` rather than compare full human-readable messages.

## Telegram bot integration requirements

1. Show a rating action only in a repair-order context the bot has already authorized for the current Telegram customer.
2. Keep the internal `repair_order_id` in trusted server-side/session callback state. Do not expose it as a user-editable input.
3. Submit the selected grade and optional notes through the bot backend using its Basic Auth credentials.
4. On `200`, acknowledge the customer and disable or replace the rating controls to avoid confusing repeat submissions.
5. On a transient network failure, retrying the same request is safe because submissions are idempotent per order and source.
6. On `400`, correct only the invalid local state or input. On `401`, alert operations/configuration owners. On `404`, stop the rating flow and refresh or safely close the order view.

### Authorization boundary

The CRM verifies that the caller is the configured Telegram bot service. This endpoint does not accept or verify a `client_id`, phone number, or Telegram user ID. Therefore, the Telegram bot must enforce customer-to-order ownership before it calls this endpoint. A valid bot credential must never be exposed to Telegram clients.

## Storage and reporting behavior

Ratings are stored in `repair_order_ratings`.

| Column                     | Behavior                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `repair_order_id`          | Required foreign key to `repair_orders.id`; ratings are deleted if the underlying order is physically deleted. |
| `source`                   | Required trusted source label; currently `Telegram`.                                                           |
| `grade`                    | Required small integer constrained by the database to `1` through `5`.                                         |
| `notes`                    | Optional feedback text.                                                                                        |
| `created_at`, `updated_at` | Server-side timestamps.                                                                                        |

The table has a unique constraint on `(repair_order_id, source)`, which enforces the no-duplicate rule even if multiple bot workers submit the same rating concurrently. It also has a `(source, created_at DESC, id DESC)` index for source-oriented reporting queries.

## Future source integrations

Do not add a `source` field to the Telegram request body. The source is intentionally server-controlled so one client cannot impersonate another channel.

When adding another channel, implement a separately authenticated adapter/controller that calls the shared rating service with its fixed source value. Extend the source type in the backend and preserve the existing `(repair_order_id, source)` uniqueness rule. This lets, for example, a web survey retain its own rating for an order without replacing the Telegram rating.
