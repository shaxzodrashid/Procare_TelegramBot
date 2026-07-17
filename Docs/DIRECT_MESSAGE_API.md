# Send Direct Message API

## Postman placement

- Workspace: `Procare_TelegramBot`
- Collection: `Bot APIs / Messages`
- Request: `Send Direct Message`

## Endpoint

```http
POST {{BOT_API_BASE_URL}}/messages/send
Authorization: Bearer {{API_MESSAGE_SEND_TOKEN}}
Content-Type: application/json
```

The API sends a Telegram message to the registered client identified by exactly one of
`phone_number` or `crm_client_id`. CRM-triggered repair-order delivery should use the stable
`crm_client_id`; manual and legacy callers may use a phone number, which the Bot normalizes to
`+998XXXXXXXXX` before lookup.

## Request body

| Field                   | Required                             | Type           | Description                                                                                                                                         |
| ----------------------- | ------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phone_number`          | Conditional                          | string         | Registered Uzbek phone number. Mutually exclusive with `crm_client_id`.                                                                             |
| `crm_client_id`         | Conditional                          | string         | Stable CRM client ID stored with the Telegram registration. Mutually exclusive with `phone_number`; preferred for repair-order automation.          |
| `localized_messages`    | Conditional                          | object         | Locale-specific message variants. Requires both `uz` and `ru`.                                                                                      |
| `localized_messages.uz` | When `localized_messages` is present | string         | Uzbek message template.                                                                                                                             |
| `localized_messages.ru` | When `localized_messages` is present | string         | Russian message template.                                                                                                                           |
| `localized_messages.en` | No                                   | string or null | Accepted for future use; not selected by the current bot locales.                                                                                   |
| `message`               | Conditional                          | string         | Legacy one-message fallback. Required only when `localized_messages` is absent.                                                                     |
| `variables`             | No                                   | object         | Extra primitive placeholder values. Values may be string, number, boolean, or null.                                                                 |
| `localized_variables`   | No                                   | object         | Extra locale-specific placeholder values. Each key has `uz`, `ru`, and optional `en` text; the Bot selects the recipient's locale before rendering. |
| `inline_keyboard`       | No                                   | object         | Generated `details`, `approval`, or `rating` actions, or a custom row-based keyboard containing URL, details, approval, or rating buttons.           |
| `support_reply`         | No                                   | object         | Sends as a reply to a stored client support message when its mapping exists.                                                                        |
| `type`                  | No                                   | string         | Legacy bot-template hint. It may replace the single `message` fallback, but never explicit `localized_messages`.                                     |
| `crm_comment_id`        | No                                   | UUID           | CRM comment ID used to persist an outbound support-message mapping.                                                                                 |
| `repair_order_uuid`     | No                                   | UUID           | Repair-order context when persisting an outbound support-message mapping.                                                                           |
| `order_number`          | No                                   | string         | Order-number context when persisting an outbound support-message mapping.                                                                           |
| `attachments`           | No                                   | array          | One to five trusted photo or document URLs. The bot downloads and size-checks every file before Telegram delivery.                                   |

At least one of `message`, `localized_messages`, or `attachments` is required. A keyboard requires
message text. When `localized_messages` is supplied, it is authoritative even if the legacy `type`
hint is also present: Russian users receive `localized_messages.ru`; all other users receive
`localized_messages.uz`. An active `type` template can replace only the single `message` fallback.

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
          "type": "url",
          "localized_text": {
            "uz": "Shartnoma",
            "ru": "Договор"
          },
          "url": "https://crm.procare.uz/orders/1024/contract"
        },
        {
          "type": "url",
          "localized_text": {
            "uz": "Hisob-faktura",
            "ru": "Счёт-фактура"
          },
          "url": "https://crm.procare.uz/orders/1024/invoice"
        }
      ],
      [
        {
          "type": "details",
          "localized_text": {
            "uz": "Batafsil",
            "ru": "Подробнее"
          },
          "style": "primary",
          "repair_order_uuid": "11111111-1111-4111-8111-111111111111"
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
      "repair_order_uuid": "11111111-1111-4111-8111-111111111111",
      "layout": [
        [
          {
            "type": "reject",
            "localized_text": { "uz": "Rad etish", "ru": "Отклонить" },
            "style": "danger"
          },
          {
            "type": "approve",
            "localized_text": { "uz": "Tasdiqlash", "ru": "Одобрить" },
            "style": "success"
          }
        ]
      ]
    }
  }
  ```

- `type` may be `details`, `approval`, or `rating`. The legacy top-level `repair_order` type is
  accepted as an alias for `details`.
- `layout` is an array of Telegram button rows. CRM controls row placement and button order. Every
  layout button accepts `type`, `text`, `localized_text`, and `style`; `repair_order_uuid` remains at
  the keyboard level so CRM cannot attach a different order to an individual action. Every layout
  button requires either `text` or `localized_text`. For approval decisions, the bot accepts these
  presentation fields for contract compatibility but deliberately renders canonical localized
  labels and colors from the semantic subtype.
- `details` requires exactly one button whose subtype is `details`. Without `layout`, optional
  top-level `text`, `localized_text`, or the bot's localized default is used. A top-level `style` may
  also be supplied. Back restores the exact original Telegram text entities and full original inline
  keyboard.
- `approval` requires exactly one `reject` and one `approve` subtype. They may be placed as
  `REJECT | APPROVE`, `APPROVE | REJECT`, or as two one-button rows in either order. Approve requires
  an explicit confirmation. The bot always renders `reject` as the localized red Reject control and
  `approve` as the localized green Approve control, so authored labels or styles cannot make the
  visible action contradict its callback. For already-delivered legacy keyboards, the handler also
  treats a `success` button as Approve and a `danger` button as Reject if its stored callback was
  reversed.
  Reject requires a 1–4,000 character explanation and then an explicit confirmation. Before each
  CRM decision, new deliveries use the trusted numeric `order_number` embedded in the bot-generated
  callback; legacy deliveries resolve it from the exact Telegram message's durable mapping. The bot
  reloads the order through the client-owned detail endpoint, verifies that its UUID still matches
  `repair_order_uuid`, and requires `initial_problems_approval.requires_action = true`.
- `rating` requires exactly five subtypes, `rating_1` through `rating_5`, each used once. Its layout
  must have one row of five buttons. The subtype—not the visible text—determines the submitted
  grade. After a successful submission the rating controls are removed. Rating retries are safe
  because CRM upserts the one current Telegram rating for the order.
- Generated action keyboards always require a valid internal `repair_order_uuid`. A custom `layout`
  cannot be combined with top-level `text`, `localized_text`, or `style`. Top-level button
  presentation is supported only by `details`; `rating` customizes its buttons through `layout`,
  while approval `layout` controls placement only. Omitting `layout` preserves the bot's default
  localized action layouts. Approval controls always render Reject as `danger` and Approve as
  `success`.

Custom row-based keyboards use `inline_keyboard.rows`:

- `inline_keyboard` must be a JSON object and `rows` must be an array containing 1–8 rows.
- Every row must be an array containing 1–4 button objects. The complete keyboard may contain at
  most 32 buttons.
- Every button requires one of these `type` values: `url`, `details`, `repair_order`, `approval`, or
  `rating`. `repair_order` is the legacy row-button alias for `details`.
- Any supplied `text` must be a non-empty string after trimming and contain at most 64 characters.
- `url` buttons require `text` or `localized_text` and an absolute `http` or `https` `url`.
- Every non-URL button requires a syntactically valid `repair_order_uuid`.
- Every button type, including `url`, may use `text` or `localized_text`. For non-URL action buttons,
  omitting both uses the bot's localized default label. When both are supplied, `text` is the
  explicit fallback and the locale-selected `localized_text` takes precedence.
- When `localized_text` is supplied, it must be an object with required `uz` and `ru` strings.
  Both must be non-empty after trimming and contain at most 64 characters. `en` is optional and may
  be `null`; when it is a string, it has the same non-empty and 64-character requirements.
- Every row or layout button may set `style` to `danger` (red), `success` (green), or `primary`
  (blue). Omitting `style` leaves Telegram's client-specific default appearance. These values map
  directly to the `InlineKeyboardButton.style` field introduced in Telegram Bot API 9.4.
- A row-based `details` or `repair_order` button opens the repair-order detail view. A row-based
  `approval` button opens the Reject/Approve chooser, and a row-based `rating` button opens grades
  1–5 in one row. These flows provide Back navigation.
- Callers provide semantic button types rather than Telegram `callback_data`. The bot generates
  callback data internally from the action type, trusted `repair_order_uuid`, and numeric
  `order_number` when supplied; callers must not depend on custom callback payloads.

Telegram accepts one inline-keyboard object per message. Multiple controls and layouts are expressed
as rows inside that object; they are not sent as separate keyboards.

## URL attachments

```json
{
  "phone_number": "+998901234567",
  "localized_messages": {
    "uz": "Kafolat hujjatingiz tayyor.",
    "ru": "Ваш гарантийный документ готов."
  },
  "repair_order_uuid": "11111111-1111-4111-8111-111111111111",
  "order_number": "1024",
  "attachments": [
    {
      "type": "document",
      "url": "https://storage.example.test/documents/warranty.pdf",
      "file_name": "warranty-1024.pdf"
    }
  ],
  "inline_keyboard": {
    "rows": [
      [
        {
          "type": "url",
          "localized_text": { "uz": "Onlayn nusxa", "ru": "Онлайн-копия" },
          "url": "https://storage.example.test/documents/warranty.pdf"
        }
      ],
      [
        {
          "type": "details",
          "localized_text": { "uz": "Batafsil", "ru": "Подробнее" },
          "style": "primary",
          "repair_order_uuid": "11111111-1111-4111-8111-111111111111"
        }
      ]
    ]
  }
}
```

Attachment `type` may be `photo` or `document`. Every URL must be HTTP(S), and every downloaded file
must be non-empty. Photos are limited to 5 MB each; documents are limited to 20 MB each. The complete
request may contain at most five attachments.

When there is exactly one attachment and the rendered text fits Telegram's 1,024-character caption
limit, that photo or document is the direct message: it carries both the caption and inline keyboard.
Caption-aware action navigation edits and restores the media caption safely; an order-detail view
that exceeds the caption limit is sent as an additional text reply while the original attachment
stays intact. If the original rendered caption is too long, the text is sent separately. Multiple
photos use a Telegram media group and keep any inline keyboard on a separate text message because
Telegram media groups do not accept reply markup.
Documents or mixed attachment types are delivered in request order. The successful API response
still returns the exact locale-selected text sent by the bot.

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
2. `200 Sent localized document` — downloads a PDF URL and sends locale-selected text plus a
   localized, styled two-row keyboard.
3. `400 Invalid body` — omits `message`, `localized_messages`, and `attachments`.
4. `400 Invalid button style` — supplies a style outside `danger`, `success`, and `primary`.
5. `400 Unresolved variable` — includes a placeholder without a supplied or built-in value.
6. `401 Unauthorized`.
7. `404 User not found`.
8. `409 Telegram user blocked`.
9. `502 Telegram delivery failed`.
10. `503 Delivery unavailable`.
