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
| `parse_mode`            | No                                   | string         | `HTML` or `MarkdownV2`. Defaults to `HTML` for backward compatibility.                                                                               |
| `inline_keyboard`       | No                                   | object         | Inline URL and repair-order action buttons.                                                                                                         |
| `support_reply`         | No                                   | object         | Sends as a reply to a stored client support message when its mapping exists.                                                                        |
| `type`                  | No                                   | string         | Existing message-template type. An active template of this type takes precedence.                                                                   |
| `crm_comment_id`        | No                                   | UUID           | CRM comment ID used to persist an outbound support-message mapping.                                                                                 |
| `repair_order_uuid`     | No                                   | UUID           | Repair-order context when persisting an outbound support-message mapping.                                                                           |
| `order_number`          | No                                   | string         | Order-number context when persisting an outbound support-message mapping.                                                                           |

At least one of `message` or `localized_messages` is required. When both are supplied and no
active `type` template replaces the content, `localized_messages` takes precedence: Russian users
receive `localized_messages.ru`; all other users receive `localized_messages.uz`.

The selected message is rendered with primitive and locale-specific variables before sending. The
response returns that exact final text passed to Telegram. A `localized_variables` value takes
precedence over an identically named `variables` value. Built-in variables still cannot be
overridden.

### Built-in variables

The following values come from the registered user and cannot be overridden by `variables`:

`first_name`, `last_name`, `full_name`, `phone_number`, `telegram_username`, `locale`.

Unresolved placeholders cause a `400` response. A request may contain at most 100 primitive and 100
localized variable entries, each string value may contain at most 4,096 characters, and the final
rendered message must be non-empty and at most 4,096 characters after Telegram entity parsing. To
bound parsing work while allowing markup overhead and escaped values, each authored message variant
and the final formatted source may contain at most 16,384 characters.

### Rich text and safe variable composition

The endpoint supports Telegram's complete regular-message rich-text syntax through `HTML` and
modern `MarkdownV2`. It deliberately does not enable legacy `Markdown`, which lacks underline,
strikethrough, spoiler, blockquote, expandable blockquote, and custom-emoji support.

- `HTML` is the default and supports Telegram tags such as `<b>`, `<i>`, `<u>`, `<s>`,
  `<tg-spoiler>`, `<a>`, `<code>`, `<pre>`, `<blockquote>`, and `<tg-emoji>`.
- `MarkdownV2` supports bold, italic, underline, strikethrough, spoilers, inline links, code blocks,
  blockquotes, expandable blockquotes, and custom emoji using Telegram's MarkdownV2 syntax.
- Authored markup is preserved. Every interpolated built-in, primitive, or localized variable is
  escaped for the selected mode, so upstream or user-controlled values cannot close an HTML tag or
  accidentally create Markdown entities.
- Apply formatting around a placeholder—for example `<b>{{first_name}}</b>` or
  `*{{first_name}}*`. Variable values are treated as text, not as trusted markup.
- If Telegram rejects malformed authored markup, the API returns `400 Invalid ... message
  formatting`; unrelated Telegram delivery failures remain `502`.
- When a repair-order button edits a rich message, the Back action restores Telegram's parsed
  message entities, preserving formatting regardless of whether the source used HTML or MarkdownV2.

Active database templates selected through `type` are authored as Telegram HTML and always use
HTML delivery. `parse_mode` controls caller-supplied `message` and `localized_messages` content.

#### HTML example

```json
{
  "phone_number": "+998901234567",
  "message": "<b>Salom, {{first_name}}</b>\\n<blockquote>{{status_note}}</blockquote>",
  "parse_mode": "HTML",
  "variables": {
    "status_note": "Screen & battery diagnostics completed"
  }
}
```

#### MarkdownV2 example

```json
{
  "phone_number": "+998901234567",
  "localized_messages": {
    "uz": "*Salom, {{first_name}}*\\nQurilma: ||{{phone_category}}||",
    "ru": "*Здравствуйте, {{first_name}}*\\nУстройство: ||{{phone_category}}||"
  },
  "parse_mode": "MarkdownV2",
  "localized_variables": {
    "phone_category": {
      "uz": "iPhone 15 Pro_Max",
      "ru": "iPhone 15 Pro_Max"
    }
  }
}
```

The underscore in `Pro_Max` is escaped automatically during interpolation. Callers must author the
surrounding MarkdownV2 syntax correctly; they must not pre-escape variable values.

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
    "uz": "<b>Salom {{first_name}}</b>. Qurilma: <u>{{phone_category}}</u>",
    "ru": "<b>Здравствуйте, {{first_name}}</b>. Устройство: <u>{{phone_category}}</u>"
  },
  "parse_mode": "HTML",
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
  "message": "<b>Здравствуйте, Ali</b>. Устройство: <u>iPhone 15 Pro</u>"
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

- `inline_keyboard.rows` must contain 1–8 rows.
- Each row must contain 1–4 buttons; the whole keyboard may contain at most 32 buttons.
- `url` buttons require non-empty `text` and an `http` or `https` `url`.
- `repair_order` buttons require a valid `repair_order_uuid`. Their `text` is optional and is
  localized by the bot when omitted.

## Responses

| Status | Meaning                                                           | Response example                                                                                                       |
| ------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `200`  | Delivered                                                         | `{ "status": "sent", "message": "final rendered Telegram text" }`                                                      |
| `400`  | Invalid request, unresolved variable, invalid rendered message, or malformed rich text | `{ "statusCode": 400, "error": "BadRequest", "message": "..." }`                                                       |
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
