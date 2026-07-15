# Send Direct Message by Phone API

## Postman placement

- Workspace: `Procare_TelegramBot`
- Collection: `Bot APIs / Messages`
- Request: `Send Direct Message by Phone`

## Endpoint

```http
POST {{BOT_API_BASE_URL}}/messages/send
Authorization: Bearer {{API_MESSAGE_SEND_TOKEN}}
Content-Type: application/json
```

The API sends a Telegram message to the registered user identified by `phone_number`.
It normalizes Uzbek phone formats to `+998XXXXXXXXX` before lookup.

## Request body

| Field                   | Required                             | Type           | Description                                                                                                                                         |
| ----------------------- | ------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phone_number`          | Yes                                  | string         | Registered Uzbek phone number.                                                                                                                      |
| `localized_messages`    | Conditional                          | object         | Locale-specific message variants. Requires both `uz` and `ru`.                                                                                      |
| `localized_messages.uz` | When `localized_messages` is present | string         | Uzbek message template.                                                                                                                             |
| `localized_messages.ru` | When `localized_messages` is present | string         | Russian message template.                                                                                                                           |
| `localized_messages.en` | No                                   | string or null | Accepted for future use; not selected by the current bot locales.                                                                                   |
| `message`               | Conditional                          | string         | Legacy one-message fallback. Required only when `localized_messages` is absent.                                                                     |
| `variables`             | No                                   | object         | Extra primitive placeholder values. Values may be string, number, boolean, or null.                                                                 |
| `localized_variables`   | No                                   | object         | Extra locale-specific placeholder values. Each key has `uz`, `ru`, and optional `en` text; the Bot selects the recipient's locale before rendering. |
| `inline_keyboard`       | No                                   | object         | Generated `details`, `approval`, or `rating` actions, or a custom row-based URL/details keyboard.                                                    |
| `support_reply`         | No                                   | object         | Sends as a reply to a stored client support message when its mapping exists.                                                                        |
| `type`                  | No                                   | string         | Existing message-template type. An active template of this type takes precedence.                                                                   |
| `crm_comment_id`        | No                                   | UUID           | CRM comment ID used to persist an outbound support-message mapping.                                                                                 |
| `repair_order_uuid`     | No                                   | UUID           | Repair-order context when persisting an outbound support-message mapping.                                                                           |
| `order_number`          | No                                   | string         | Order-number context when persisting an outbound support-message mapping.                                                                           |
| `attachments`           | No                                   | array          | One to five trusted photo URLs. The bot downloads and size-checks every photo before Telegram delivery.                                              |

At least one of `message`, `localized_messages`, or `attachments` is required. A keyboard requires
message text. When both message forms are supplied and no
active `type` template replaces the content, `localized_messages` takes precedence: Russian users
receive `localized_messages.ru`; all other users receive `localized_messages.uz`.

The selected message is rendered with primitive and locale-specific variables before sending. The
response returns that exact final text passed to Telegram. A `localized_variables` value takes
precedence over an identically named `variables` value. Built-in variables still cannot be
overridden.

### Built-in variables

The following values come from the registered user and cannot be overridden by `variables`:

`first_name`, `last_name`, `full_name`, `phone_number`, `telegram_username`, `locale`.

Unresolved placeholders cause a `400` response. The final rendered message must be non-empty and
at most 4,096 characters.

### CRM repair-order variables

CRM template dispatch supports the variables below. They are documented here so CRM templates can
use the same names, but **the direct-message API does not automatically load or populate these
repair-order values**. Its only automatic values are the built-in registered-user variables listed
above. Until the Telegram Bot adds equivalent repair-order context, a direct-message caller must
provide the required CRM values explicitly through `variables` or `localized_variables`.

| Placeholder | CRM value | Supply to the direct-message API as |
| --- | --- | --- |
| `{{order_number}}` | Repair-order number | `variables` |
| `{{repair_order_uuid}}` | Repair-order UUID | `variables` |
| `{{customer_name}}` | Stored repair-order customer name | `variables` |
| `{{status_name_uz}}`, `{{status_name_ru}}`, `{{status_name_en}}` | Customer-visible status name for the named locale | `variables` |
| `{{progress_step}}`, `{{progress_total_steps}}` | Current customer-status step and total steps | `variables` |
| `{{problem_name}}` | Final-problem category name | `variables` |
| `{{phone_category}}` | Device category | `localized_variables` |
| `{{status_name}}` | Current customer-visible status name | `localized_variables` |
| `{{branch_name}}` | Repair branch name | `localized_variables` |
| `{{customer_phone_number}}` | Repair-order contact phone | `variables` |
| `{{order_description}}`, `{{imei}}` | Stored order description and IMEI | `variables` |
| `{{priority}}`, `{{source}}`, `{{pickup_method}}`, `{{delivery_method}}` | Order metadata | `variables` |
| `{{agreed_date}}`, `{{estimated_ready_at}}`, `{{completed_at}}`, `{{repaired_at}}`, `{{delivered_at}}` | Order lifecycle dates | `variables` |
| `{{total_price}}`, `{{currency}}` | Repair-order total and ISO currency code | `variables` |
| `{{final_problems_count}}` | Number of final problems | `variables` |
| `{{final_problems_total_price}}`, `{{parts_total_price}}` | Final-problem labor total and assigned-parts total | `variables` |
| `{{final_problems}}` | Numbered final-problem names | `localized_variables` |
| `{{final_problems_with_prices}}` | Final problems with labor prices | `localized_variables` |
| `{{final_problems_with_parts}}` | Final problems with assigned part names and quantities | `localized_variables` |
| `{{final_problems_with_total}}` | Final problems, assigned parts, and problem-plus-parts totals | `localized_variables` |
| `{{final_problems_detailed}}` | Final problems with prices and assigned-part unit/line prices | `localized_variables` |
| `{{initial_problems_count}}` | Number of initial problems | `variables` |
| `{{initial_problems_total_price}}`, `{{initial_parts_total_price}}` | Initial-problem labor total and assigned-parts total | `variables` |
| `{{initial_problems}}` | Numbered initial-problem names | `localized_variables` |
| `{{initial_problems_with_prices}}` | Initial problems with labor prices | `localized_variables` |
| `{{initial_problems_with_parts}}` | Initial problems with assigned part names and quantities | `localized_variables` |
| `{{initial_problems_with_total}}` | Initial problems, assigned parts, and problem-plus-parts totals | `localized_variables` |
| `{{initial_problems_detailed}}` | Initial problems with prices and assigned-part unit/line prices | `localized_variables` |

The problem-list values are already rendered by CRM; they are not loop expressions. For
`localized_variables`, supply the appropriate `uz` and `ru` text for every locale-aware value.

### Locale-specific variables

Use `localized_variables` whenever a placeholder must follow the recipient locale. This keeps one
template variable—for example `{{phone_category}}` or `{{final_problems_detailed}}`—correct for
both Uzbek and Russian recipients.

```json
{
  "phone_number": "+998901234567",
  "localized_messages": {
    "uz": "Qurilma: {{phone_category}}\n{{final_problems_detailed}}",
    "ru": "Устройство: {{phone_category}}\n{{final_problems_detailed}}"
  },
  "localized_variables": {
    "phone_category": {
      "uz": "iPhone 15 Pro",
      "ru": "iPhone 15 Pro",
      "en": "iPhone 15 Pro"
    },
    "final_problems_detailed": {
      "uz": "1. Ekran — 100000 UZS\n   Qismlar: 1 × Display — 80000 UZS / 80000 UZS",
      "ru": "1. Экран — 100000 UZS\n   Запчасти: 1 × Display — 80000 UZS / 80000 UZS"
    }
  }
}
```

The API deliberately does not support loops or arbitrary expressions inside a message template.
The caller must provide a rendered string for every list-like value. This makes delivery
deterministic and preserves the final 4,096-character Telegram limit.

## Localized delivery example

```json
{
  "phone_number": "+998901234567",
  "localized_messages": {
    "uz": "Salom {{first_name}}. Qurilma: {{phone_category}}",
    "ru": "Здравствуйте, {{first_name}}. Устройство: {{phone_category}}"
  },
  "localized_variables": {
    "phone_category": {
      "uz": "iPhone 15 Pro",
      "ru": "iPhone 15 Pro"
    }
  },
  "inline_keyboard": {
    "rows": [
      [
        {
          "type": "repair_order",
          "text": "Buyurtmani ko‘rish",
          "repair_order_uuid": "11111111-1111-4111-8111-111111111111"
        }
      ],
      [
        {
          "type": "url",
          "text": "CRM",
          "url": "https://crm.procare.uz/orders/1024"
        }
      ]
    ]
  }
}
```

For a Russian user named Ali, the successful response is:

```json
{
  "status": "sent",
  "message": "Здравствуйте, Ali. Устройство: iPhone 15 Pro"
}
```

## Legacy fallback example

Use `message` only when the caller does not have distinct Uzbek and Russian copy:

```json
{
  "phone_number": "+998901234567",
  "message": "Salom {{first_name}}",
  "variables": {}
}
```

## Optional support reply

```json
{
  "phone_number": "+998901234567",
  "localized_messages": {
    "uz": "Murojaatingizga javob tayyor.",
    "ru": "Ответ на ваше обращение готов."
  },
  "support_reply": {
    "target_crm_comment_id": "22222222-2222-4222-8222-222222222222"
  }
}
```

If the supplied CRM comment maps to a stored Telegram client message for this user, delivery is a
Telegram reply. Missing or rejected reply targets fall back to a normal Telegram message.

## Inline keyboard rules

- Generated repair-order keyboards use this compact shape:

  ```json
  {
    "inline_keyboard": {
      "type": "approval",
      "repair_order_uuid": "11111111-1111-4111-8111-111111111111"
    }
  }
  ```

- `type` may be `details`, `approval`, or `rating`. The legacy top-level `repair_order` type is
  accepted as an alias for `details`.
- `details` creates one localized button. It may include optional `text`; Back restores the exact
  original Telegram text entities and full original inline keyboard.
- `approval` creates Reject followed by Approve. Approve requires an explicit confirmation.
  Reject requires a 1–4,000 character explanation and then an explicit confirmation. Before each
  CRM decision, the bot reloads the order through the client-owned detail endpoint and requires
  `initial_problems_approval.requires_action = true`.
- `rating` creates grades 1–5, matching the current CRM rating contract. After a successful
  submission the rating controls are removed. Rating retries are safe because CRM upserts the one
  current Telegram rating for the order.
- Generated action keyboards always require a valid internal `repair_order_uuid`. `text` is
  accepted only by `details`.
- `inline_keyboard.rows` must contain 1–8 rows.
- Each row must contain 1–4 buttons; the whole keyboard may contain at most 32 buttons.
- `url` buttons require non-empty `text` and an `http` or `https` `url`.
- Row buttons may use `details` or the legacy `repair_order` name. They require a valid
  `repair_order_uuid`; `text` is optional and localized by the bot when omitted.
- CRM template rows may also use `approval` and `rating` plus `localized_text` containing required
  `uz` and `ru` labels and optional `en`. Those labels open the action flow; approval then shows
  Reject/Approve and rating then shows grades 1–5. Both chooser views provide Back navigation.

## Staff comment photo attachments

```json
{
  "phone_number": "+998901234567",
  "message": "Please review the diagnosis.",
  "repair_order_uuid": "11111111-1111-4111-8111-111111111111",
  "order_number": "1024",
  "attachments": [
    {
      "type": "photo",
      "url": "https://storage.example.test/comment/photo-medium.jpg",
      "file_name": "diagnosis.jpg"
    }
  ],
  "inline_keyboard": {
    "type": "approval",
    "repair_order_uuid": "11111111-1111-4111-8111-111111111111"
  }
}
```

Only `photo` attachments are accepted. Every URL must be HTTP(S); each downloaded file must be
non-empty and no larger than 5 MB. With a keyboard, photos are sent first and the editable text
message carries the keyboard so details/approval/rating navigation can safely edit and restore it.
The successful API response still returns the exact text sent by the bot.

The bot does not persist attachment files to local disk or object storage. It holds downloaded
bytes in memory only for the Telegram API call. The authenticated caller owns the source object's
lifecycle; the CRM staff-comment integration deletes its dedicated temporary delivery object after
this endpoint confirms `status=sent`.

## Replying to proactive CRM messages

An outbound CRM support message remains replyable even when no support chat is active in the bot.
CRM must supply `crm_comment_id`, `repair_order_uuid`, and `order_number` so the delivered Telegram
message is persisted as a support-thread anchor. The client then uses Telegram's **Reply** action on
that exact message.

On reply, the bot restores the registered client, resolves the stored Telegram message mapping,
requires the mapping to belong to that Telegram user and CRM client, and reloads the client-owned
repair order. Only then does it send the reply to CRM and activate that order's support chat for
follow-up text. Ordinary unthreaded text does not guess an order and does not open a global support
thread.

## Responses

| Status | Meaning                                                           | Response example                                                                                                       |
| ------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `200`  | Delivered                                                         | `{ "status": "sent", "message": "final rendered Telegram text" }`                                                      |
| `400`  | Invalid request, unresolved variable, or invalid rendered message | `{ "statusCode": 400, "error": "BadRequest", "message": "..." }`                                                       |
| `401`  | Missing or invalid bearer token                                   | `{ "statusCode": 401, "error": "Unauthorized", "message": "A valid Bearer token is required" }`                        |
| `404`  | No registered Telegram user matches the phone                     | `{ "statusCode": 404, "error": "NotFound", "message": "No registered Telegram user was found for this phone number" }` |
| `409`  | User is marked as blocked                                         | `{ "statusCode": 409, "error": "Conflict", "message": "Telegram user is marked as blocked" }`                          |
| `502`  | Telegram message delivery failed                                  | `{ "statusCode": 502, "error": "BadGateway", "message": "Telegram message delivery failed" }`                          |
| `503`  | Telegram delivery is not configured                               | `{ "statusCode": 503, "error": "ServiceUnavailable", "message": "Telegram message delivery is not available" }`        |

## Postman saved examples to update

1. `200 Sent localized message` — uses the localized-delivery request and returns the rendered
   final message.
2. `400 Invalid body` — omits both `message` and `localized_messages`.
3. `400 Unresolved variable` — includes a placeholder without a supplied or built-in value.
4. `401 Unauthorized`.
5. `404 User not found`.
6. `409 Telegram user blocked`.
7. `502 Telegram delivery failed`.
8. `503 Delivery unavailable`.
