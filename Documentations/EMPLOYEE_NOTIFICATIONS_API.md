# Employee notifications

The bot owns notification types and durable preferences. CRM manages them through the bot's
service API and triggers delivery using CRM employee account IDs. CRM must keep the service token
on its backend and authorize its own users before exposing management or preference actions.
This repository implements the bot API and Telegram controls; the CRM management screens and
event producers must call the endpoints below.

Every endpoint requires `Authorization: Bearer <API_MESSAGE_SEND_TOKEN>`. Catalog and preference
management work when the Telegram bot is disabled. Sending then returns `503`.

## Routes

| Method | Route                                                                  | Purpose                               |
| ------ | ---------------------------------------------------------------------- | ------------------------------------- |
| GET    | `/employee-notifications/types`                                        | List types, including inactive types  |
| PUT    | `/employee-notifications/types/{key}`                                  | Create or fully replace a type        |
| GET    | `/employee-notifications/employees/{crmAdminId}/preferences`           | Read effective account preferences    |
| PUT    | `/employee-notifications/employees/{crmAdminId}/preferences/{typeKey}` | Set an explicit account preference    |
| POST   | `/employee-notifications/send`                                         | Deliver to selected employee accounts |

Type keys are stable lowercase identifiers matching `[a-z][a-z0-9_]{0,31}`. Retire types by setting
`is_active: false`; there is no deletion endpoint, so reactivation preserves preferences. Do not
change a key to rename a type: update its localized names instead.

## Configure a type

`PUT /employee-notifications/types/order_assigned`:

```json
{
  "name_uz": "Yangi buyurtma",
  "name_ru": "Новый заказ",
  "is_active": true,
  "default_enabled": true,
  "message_template": {
    "localized_messages": {
      "uz": "*{{first_name}}*, sizga yangi buyurtma biriktirildi: {{number}}",
      "ru": "*{{first_name}}*, вам назначен новый заказ: {{number}}"
    },
    "parse_mode": "MarkdownV2",
    "inline_keyboard": {
      "rows": [
        [
          {
            "type": "url",
            "localized_text": { "uz": "CRM’da ochish", "ru": "Открыть в CRM" },
            "url": "https://crm.example.test/repair-orders",
            "style": "primary"
          }
        ]
      ]
    }
  }
}
```

Both names (1–120 characters), both boolean flags, and `message_template` are required. Responses
wrap the saved type in `{ "data": { ... } }`; lists use `{ "data": [ ... ] }`. Returned templates
use the same request field names and can be sent back to PUT.

The template accepts the message fields from [direct delivery](DIRECT_MESSAGE_API.md): `message`,
`localized_messages`, `variables`, `localized_variables`, `parse_mode`, `inline_keyboard`, `type`,
`repair_order_uuid`, `order_number`, and `attachments`. It requires message text, localized text, or
attachments; an inline keyboard requires message text. Recipient and support-thread fields are
not accepted. The notification key is independent of the existing fixed message-template `type`.

Authored HTML or MarkdownV2 markup is preserved. Every interpolated variable is escaped for its
parse mode and context, including code and link targets. Recipient identity variables are supplied
by the bot (`first_name`, `last_name`, `full_name`, `phone_number`, `telegram_username`, `locale`).
Recipient locale selects Uzbek or Russian text and localized variable/button values. Existing
database templates selected with `type` remain HTML-authored.

Attachments use `{ "type": "photo" | "document", "url": "https://...", "file_name": "..." }`.
Existing delivery limits apply: at most five attachments, 5 MiB per photo, 20 MiB per document,
4,096 visible text characters, and 1,024 caption characters. Long captions become separate text
messages; photos can become albums. Download and format failures are reported per recipient.
Use CRM URL buttons for employee actions. Existing repair-order details/approval/rating callback
buttons retain their customer authorization rules and do not grant CRM employee access.

## Account preferences

`PUT /employee-notifications/employees/{crmAdminId}/preferences/order_assigned`:

```json
{ "enabled": false }
```

The response is `{ "type_key": "order_assigned", "enabled": false }`. GET returns rows with
`type_key`, `name_uz`, `name_ru`, `is_active`, and effective `enabled`.

An explicit preference overrides `default_enabled`, including explicit `false`. Changes to a
type's default affect only accounts without an explicit preference. Inactive types cannot send,
regardless of the account preference. CRM may configure preferences before an employee links
Telegram. Preferences belong to the CRM account, apply to every linked Telegram user, and survive
logout, process restarts and deployment session resets.

Active employees also have a **Notifications** menu in Uzbek/Russian with ten types per page.
Each button sets the desired state. Stale menu messages, inactive employees, unrelated flow
states and non-private chats cannot change preferences through Telegram.

## Trigger delivery

`POST /employee-notifications/send`:

```json
{
  "type_key": "order_assigned",
  "crm_admin_ids": ["crm-employee-id"],
  "content": {
    "variables": { "number": "DP-1004" },
    "attachments": [
      {
        "type": "document",
        "url": "https://files.example.test/order.pdf",
        "file_name": "order.pdf"
      }
    ]
  }
}
```

Supply 1–100 CRM employee IDs. Duplicate IDs are removed. `content` is optional and accepts
partial template overrides using the same message fields. Variable maps merge with template
defaults; supplied values win. Other supplied fields replace the configured field. A supplied
`message` replaces localized default text; supplying either text form also clears a default
database-template selection unless `type` is explicitly supplied. Omitted parse mode preserves
the configured mode (HTML is the delivery default). There is no automatic retry or idempotency
key: resending a request can duplicate delivered messages.

```json
{
  "status": "processed",
  "results": [{ "crm_admin_id": "crm-employee-id", "telegram_id": "7001", "status": "sent" }]
}
```

`200 processed` means the request was processed, not that every recipient received it. Inspect
each result: `sent`, `disabled`, `type_inactive`, `not_found`, `blocked`, `invalid_message`,
`invalid_attachments`, or `failed`. Accounts with multiple active Telegram registrations return
one result per registration; skipped/unregistered accounts return an account-level result.
Only active persisted employee registrations are eligible. Existing customer message routes
remain independent and should not be used to trigger typed employee notifications.

Missing types return `404`; malformed input returns `400`; invalid service credentials return
`401`; unavailable storage/delivery returns `503`. Storage failures use the existing API error
handler. Successful and failed Telegram delivery attempts reuse `message_dispatch_logs` with
`dispatch_type = employee:{key}` and blocked-user tracking. Preference skips do not log a
Telegram delivery attempt.

## Rollout and existing support alerts

The forward migration creates `employee_notification_types` and
`employee_notification_preferences` without changing existing tables or clearing user data.
Startup runs it automatically; production rollout uses `./deploy.sh up`.

The migration seeds `support_comment` as active and enabled by default, preserving existing
assigned-employee alerts for new customer support comments. CRM can configure its content and
defaults, and employees can opt out. The event supplies `number` and `id` variables only; the
customer's support text and attachments are not copied into the employee alert.

Other notification types have no implicit event producer. CRM must configure a type and call
`/employee-notifications/send` from the relevant event workflow. This change does not implement
CRM frontend screens, broadcasts, queues, scheduled campaigns or guaranteed delivery.
