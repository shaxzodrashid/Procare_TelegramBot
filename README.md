# Procare Telegram Bot

Procare Telegram Bot is a TypeScript service that connects Telegram users to Procare CRM. It
registers existing clients by their shared phone number, fetches customer-safe repair tracking data,
and lets unknown clients submit a public repair request.

The process also exposes a small Fastify health API and stores Telegram user registrations in
PostgreSQL, including separate client and employee role rows.

## Features

- grammY bot using long polling
- Uzbek and Russian user flows
- Telegram shared-contact ownership validation
- development-only manual phone number entry during registration
- Uzbek phone normalization to `+998XXXXXXXXX`
- CRM client lookup using HTTP Basic Auth
- authenticated, paginated customer repair-order list and detail tracking
- bounded retries for safe upstream reads
- repair catalog navigation with category pagination
- multi-select repair problems and an optional note
- public repair-order submission with confirmation
- PostgreSQL upsert for registered clients, registered employees, and unknown clients who decline or
  cancel
- database-backed transactional message templates with Uzbek/Russian rendering
- Telegram notification dispatch logging and blocked-user tracking for template messages
- employee-only template management inside the bot
- employee-managed customer-facing repair-order status names sourced from CRM
- configured Developer seat for endpoint inventory and API error-location localizations
- API-triggered direct Telegram messages to registered users by phone number
- localized rich repair-order cards with classic Telegram HTML fallback
- customer support comments from repair-order detail cards to assigned employees or branch staff
- Fastify `GET /health` endpoint
- console and per-session file logging
- automatic Knex migrations and graceful shutdown
- localized Telegram command menu for `/start`, `/help`, and `/logout`

## User Flow

```text
/start
  -> choose Uzbek or Russian
  -> share own Telegram phone contact
     (or type the phone number manually when NODE_ENV=development)
  -> existing CRM client
       -> show profile confirmation
       -> fetch repair orders when "My orders" is opened
       -> open and explicitly refresh customer-safe order details
       -> start a support chat from a selected order
          -> route each text or supported photo to CRM until the client ends the chat
  -> active CRM employee
       -> show employee-role confirmation
       -> manage transactional message templates
       -> manage customer-facing repair-order status names
       -> do not offer client repair orders or unknown-client repair creation
  -> unknown client
       -> offer a new repair request
       -> choose OS
       -> navigate phone model categories
       -> select repair problems
       -> add or skip a note
       -> confirm and submit, or cancel
```

If the unknown client declines the initial offer or cancels at confirmation, the service upserts
their details into the local `users` table.

`/logout` clears the in-memory bot session and deletes the current Telegram user's row from the
local `users` table if it exists.

Employees can open `Xabar shablonlari` / `Шаблоны сообщений` from their menu to list, create,
edit, activate, deactivate, or delete Telegram message templates. Template text supports
placeholders such as `{{ customer_name }}` and `{{ coupon_code }}`; rendered placeholder values are
HTML-escaped, and coupon codes are wrapped in Telegram `<code>` tags for tap-to-copy behavior.

Employees can also open `Status nomlari` / `Названия статусов` to refresh the CRM repair-order
status catalog and set Uzbek/Russian names for the status IDs returned by CRM.

Telegram IDs listed in `DEVELOPER_TELEGRAM_IDS` receive a Developer menu. Developers can view the
upstream API endpoints used by the bot and create or update Uzbek/Russian localizations for each
endpoint-specific error `location` token returned by the CRM/API error envelope. The bot also sends
these accounts private, secret-redacted diagnostic reports for Telegram update errors, including
handled failures that are written through the handler logger.

## Technology

- Node.js 20+
- TypeScript with strict NodeNext configuration
- grammY
- Fastify
- PostgreSQL
- Knex
- Node test runner, ESLint, and Prettier

## Requirements

- Node.js 20 or newer
- npm
- PostgreSQL
- a Telegram bot token
- access to the Procare CRM API
- CRM Basic Auth credentials for the bot registration endpoint

Docker and Docker Compose can provide the Node.js and PostgreSQL runtime instead.

## Local Setup

1. Create the environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Fill in at least these required values:

   ```dotenv
   BOT_TOKEN=
   CRM_BASE_URL=http://localhost:5001
   TELEGRAM_BOT_BASIC_AUTH_USER=
   TELEGRAM_BOT_BASIC_AUTH_PASSWORD=
   DB_PASS=
   ```

3. Ensure the configured PostgreSQL database exists and is reachable.

4. Install dependencies:

   ```powershell
   npm ci
   ```

5. Start the service in watch mode:

   ```powershell
   npm run dev
   ```

Database migrations run automatically during every application startup. The application will not
start if configuration validation, database connection, or migrations fail.

The health endpoint is:

```http
GET http://localhost:3000/health
```

Example response:

```json
{
  "status": "ok",
  "service": "procare-telegram-bot",
  "timestamp": "2026-06-15T10:00:00.000Z",
  "uptimeSeconds": 42,
  "checks": {
    "process": { "status": "ok" },
    "configuration": { "status": "ok" },
    "database": { "status": "ok", "latencyMs": 3 },
    "migrations": { "status": "ok" },
    "api": { "status": "ok" },
    "telegram": { "status": "ok" }
  }
}
```

The endpoint returns HTTP `503` when a required component is unhealthy. It actively verifies the
PostgreSQL connection, migration completion, API readiness, Telegram authentication/polling, and
Telegram `getMe` reachability when the bot is enabled. Startup and graceful shutdown do not send
broadcast messages to users. A deployment with a different Git commit marks stored users with
`users.should_restart = true`; their next interaction is stopped until they send `/start`, which
clears the flag and rebuilds the in-memory session from persisted registration data.

The direct message endpoint is:

```http
POST http://localhost:3000/messages/send
Authorization: Bearer <API_MESSAGE_SEND_TOKEN>
Content-Type: application/json
```

The complete Postman-ready contract, including saved-response examples, is in
[`Docs/DIRECT_MESSAGE_API.md`](Docs/DIRECT_MESSAGE_API.md).

Request:

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
      "uz": "iPhone 15 Pro",
      "ru": "iPhone 15 Pro"
    }
  },
  "support_reply": {
    "target_crm_comment_id": "22222222-2222-4222-8222-222222222222"
  },
  "attachments": [
    {
      "type": "document",
      "url": "https://files.procare.uz/warranty.pdf",
      "file_name": "warranty.pdf"
    }
  ],
  "inline_keyboard": {
    "rows": [
      [
        {
          "type": "url",
          "localized_text": { "uz": "CRM", "ru": "CRM" },
          "url": "https://crm.procare.uz/orders/1024"
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

The API normalizes Uzbek phone numbers, finds the local `users` row by `phone_number`, selects the
matching `localized_messages.uz` or `localized_messages.ru` value from that user's stored locale,
renders message variables, and sends the resulting Telegram message to that user's `telegram_id`.
`localized_messages` requires non-empty Uzbek and Russian strings and may be sent without `message`.
The legacy `message` field remains an optional fallback for callers that have only one locale; at
least one of `message`, `localized_messages`, or `attachments` is required. A keyboard additionally
requires message text through `message` or `localized_messages`. If both message forms are supplied,
the localized variant takes precedence for Uzbek and Russian users. Explicit `localized_messages`
also remain authoritative when the legacy `type` bot-template hint is present; `type` may replace
only the single `message` fallback.

Rich text supports Telegram `HTML` and modern `MarkdownV2` through `parse_mode`; `HTML` remains the
default for backward compatibility. The message template keeps its authored markup, while every
built-in, primitive, and locale-specific variable value is escaped for the selected mode before
interpolation. This makes values containing characters such as `<`, `&`, `_`, `*`, `(`, or `.` safe
without breaking surrounding bold, italic, spoiler, link, quote, code, or other Telegram entities.
Legacy `Markdown` is intentionally rejected because it cannot represent the complete formatting
set. Active database template types remain HTML-authored and therefore use HTML delivery.

Successful responses include the exact rendered message sent to Telegram:

```json
{
  "status": "sent",
  "message": "Salom Ali. Qurilma: iPhone 15 Pro"
}
```

Built-in variables come from the registered user and cannot be overridden by request variables:
`first_name`, `last_name`, `full_name`, `phone_number`, `telegram_username`, and `locale`. External
platforms may pass additional string, number, boolean, or `null` values through `variables`; for
example, `phone_category` or `repair_order_number`. `localized_variables` accepts the same primitive
value types under required `uz` and `ru` keys; its locale-selected value takes precedence over an
identically named primitive variable. Built-in values always take final precedence.

For CRM support replies, pass `support_reply.target_crm_comment_id` with the CRM comment ID of the
client message being answered. If the bot has a stored Telegram mapping for that CRM comment and the
same phone number, it sends the message as a Telegram reply to the original support message. If the
mapping is missing or Telegram no longer accepts the reply target, delivery falls back to a normal
message.

The optional `inline_keyboard` supports generated repair-order actions and custom row-based button
layouts. Generated `details`, `approval`, and `rating` keyboards accept the trusted internal
`repair_order_uuid`. Details preserve the exact original message entities and full keyboard for
Back navigation. Approval uses confirmation, requires a rejection explanation, re-authorizes the
client-owned order using the callback's trusted numeric order number (with durable message mapping
fallback for older deliveries), verifies the returned UUID, and submits the decision to CRM. Rating
uses grades 1–5 in one row. CRM can control button order through `layout`;
labels and Telegram Bot API 9.4 styles remain customizable for non-decision controls. Approval
decisions are safety-canonicalized: `approve` is always the localized green Approve button and
`reject` is always the localized red Reject button, regardless of authored label/style fields. For
already-delivered legacy keyboards, the handler follows the visible `success`/`danger` style when an
old callback was reversed. For example, approval can put Approve above Reject:

```json
{
  "inline_keyboard": {
    "type": "approval",
    "repair_order_uuid": "11111111-1111-4111-8111-111111111111",
    "layout": [
      [
        {
          "type": "approve",
          "localized_text": { "uz": "Tasdiqlash", "ru": "Одобрить" },
          "style": "success"
        }
      ],
      [
        {
          "type": "reject",
          "localized_text": { "uz": "Rad etish", "ru": "Отклонить" },
          "style": "danger"
        }
      ]
    ]
  }
}
```

Purpose validation is strict: `details` requires one `details` button; `approval` requires exactly
one `reject` and one `approve` button in one or two rows; `rating` requires each subtype from
`rating_1` through `rating_5` exactly once in one row of five. Omitting `layout` keeps the default
localized layout for backward compatibility.

The legacy top-level `repair_order` name remains an alias for `details`. Custom rows may contain URL,
details, approval, and rating buttons. The complete request can also download and deliver up to five
HTTP(S) photo or document attachments. Photos are limited to 5 MB each and documents to 20 MB each;
one attachment carries the localized caption and keyboard directly when the caption fits Telegram's
1,024-character limit. Caption-aware action navigation preserves Back restoration. Media groups keep
the keyboard on a separate localized text message because Telegram does not support reply markup on
an album.

When CRM supplies `crm_comment_id`, `repair_order_uuid`, and `order_number`, the bot persists the
outbound Telegram message as a durable support-thread anchor. A registered client can use
Telegram's Reply action on that message even when no support chat is active; the bot validates the
stored Telegram/user/client mapping, reloads the client-owned order, forwards the reply to CRM, and
activates only that order's support chat.

It returns `400` for invalid payloads, unresolved variables, or Telegram-rejected rich-text syntax;
`401` for a missing or invalid bearer token; `404` when no local user matches; `409` when the user is
already marked as blocked; `502` for other Telegram delivery failures; and `503` when the Telegram
bot is disabled so delivery is unavailable.

## Docker Compose

Create `.env`, then run:

```powershell
docker compose up --build
```

Compose starts:

- `postgres`: PostgreSQL 16 with a persistent named volume
- `bot`: the production image, with `DB_HOST` set to `postgres`

The bot container publishes `API_PORT` and mounts `./logs` at `/app/logs`.

When CRM runs on the host machine, do not leave `CRM_BASE_URL` as `http://localhost:5001` for the
container. Inside the bot container, `localhost` means the container itself. Use a reachable
Compose service name or a host address such as `host.docker.internal` where supported.

For production deploys, use the root manager script instead of raw Compose commands:

```sh
./deploy.sh down
./deploy.sh up
```

`./deploy.sh down` records deployment history, stops the bot gracefully, clears Telegram menu
commands, and then stops the full Compose stack without deleting volumes. It does not broadcast a
shutdown message.

`./deploy.sh up` pulls `origin/main` with `--ff-only`, prepares the mounted `./logs` directory for
the container user, runs `docker compose up -d --build`, waits until the bot container is healthy,
prints the `/health` report, and updates the latest open `deployment_history` database row with the
exact database-server `started_at` timestamp, shutdown period, current Git commit SHA, and full Git
commit message. After migrations and health checks pass, it compares the current Git SHA with the
previous healthy deployment. If they differ, all stored users are marked `should_restart = true`;
the first managed deployment also marks users when no healthy baseline exists. Restarting the same
commit does not mark them again. Override the source branch only for exceptional cases with
`DEPLOY_GIT_REMOTE` and `DEPLOY_GIT_BRANCH`.

Deployment history is stored in PostgreSQL table `deployment_history`. `./deploy.sh down` creates
the table if needed before shutdown and inserts `stopped_at` using `CURRENT_TIMESTAMP` from the
database server. `./deploy.sh up` fills `started_at`, `shutdown_period`,
`shutdown_period_seconds`, `git_commit_sha`, and `git_commit_message` after the bot is healthy.

Useful manager commands:

```sh
./deploy.sh restart
./deploy.sh status
./deploy.sh logs
```

`docker compose down -v` deletes the PostgreSQL volume and all data in it. Use that command only for
a confirmed disposable development database.

## Configuration

All supported variables are listed in `.env.example`.

| Variable                           | Default         | Requirement or purpose                            |
| ---------------------------------- | --------------- | ------------------------------------------------- |
| `NODE_ENV`                         | `development`   | `development`, `test`, or `production`            |
| `LOG_LEVEL`                        | `info`          | `info`, `debug`, or `extra-high`                  |
| `BOT_ENABLED`                      | `true`          | Enable Telegram bot startup                       |
| `BOT_TOKEN`                        | none            | Required when `BOT_ENABLED=true`                  |
| `BOT_USERNAME`                     | none            | Optional; currently not used at runtime           |
| `RICH_MESSAGES_ENABLED`            | `false`         | Rich order cards with HTML fallback               |
| `DEVELOPER_TELEGRAM_IDS`           | none            | Comma-separated Telegram IDs with Developer tools |
| `API_ENABLED`                      | `true`          | Enable the Fastify health API                     |
| `API_HOST`                         | `0.0.0.0`       | API listen host                                   |
| `API_PORT`                         | `3000`          | API listen port                                   |
| `API_MESSAGE_SEND_TOKEN`           | Required        | Bearer token for `POST /messages/send`            |
| `CRM_BASE_URL`                     | none            | Required CRM/API base URL                         |
| `TELEGRAM_BOT_BASIC_AUTH_USER`     | none            | Required CRM service username                     |
| `TELEGRAM_BOT_BASIC_AUTH_PASSWORD` | none            | Required CRM service password                     |
| `CRM_REQUEST_TIMEOUT_MS`           | `10000`         | Upstream request timeout                          |
| `CRM_MAX_RETRIES`                  | `2`             | Retry count for eligible upstream requests        |
| `DB_HOST`                          | `localhost`     | PostgreSQL host                                   |
| `DB_PORT`                          | `5432`          | PostgreSQL port                                   |
| `DB_USER`                          | `postgres`      | PostgreSQL user                                   |
| `DB_PASS`                          | none            | Required PostgreSQL password                      |
| `DB_NAME`                          | `probox_bot_db` | PostgreSQL database                               |
| `DB_SSL`                           | `false`         | Enable PostgreSQL TLS                             |
| `DB_POOL_MIN`                      | `0`             | Minimum pool size                                 |
| `DB_POOL_MAX`                      | `10`            | Maximum pool size                                 |
| `DB_ACQUIRE_TIMEOUT_MS`            | `10000`         | Connection acquisition timeout                    |

Boolean values must be lowercase `true` or `false`. Invalid configuration is reported as one
aggregated startup error.

CRM and database credentials are currently required even when the bot or API is disabled because
configuration is validated and database migrations run before optional components start.

## Commands

Telegram bot commands:

| Command   | Description                                      |
| --------- | ------------------------------------------------ |
| `/start`  | Start or restart the registration flow           |
| `/help`   | Show contextual help                             |
| `/logout` | Clear the current session and stored user record |

The bot publishes these commands to Telegram's menu in Uzbek and Russian during startup.

Development note: when `NODE_ENV=development`, a user waiting at the phone step can type a phone
number manually instead of sharing a Telegram contact. Other environments keep the contact-only
registration path.

Development commands:

| Command                | Description                       |
| ---------------------- | --------------------------------- |
| `npm run dev`          | Run the service in watch mode     |
| `npm run build`        | Compile TypeScript into `dist/`   |
| `npm start`            | Run the compiled service          |
| `npm run typecheck`    | Type-check without emitting files |
| `npm test`             | Run all tests                     |
| `npm run lint`         | Run ESLint                        |
| `npm run format`       | Format files with Prettier        |
| `npm run format:check` | Check formatting                  |
| `npm run check`        | Run typecheck, lint, and tests    |

Before submitting code changes:

```powershell
npm run check
npm run build
npm run format:check
```

## Architecture

```text
src/server.ts
  -> load and validate configuration
  -> create logger
  -> bootstrap application
       -> connect PostgreSQL and run migrations
       -> create CRM and repair API clients
       -> create PostgreSQL stores
       -> initialize Telegram bot
       -> start Fastify health API
       -> start Telegram long polling
```

Main modules:

| Path                                          | Responsibility                                |
| --------------------------------------------- | --------------------------------------------- |
| `src/app/bootstrap.ts`                        | Dependency wiring and lifecycle               |
| `src/bot/create-bot.ts`                       | Commands and conversation state machine       |
| `src/bot/messages.ts`                         | Uzbek and Russian messages                    |
| `src/bot/keyboards.ts`                        | Reply and inline keyboards                    |
| `src/bot/formatters.ts`                       | Telegram-safe presentation                    |
| `src/services/client-registration.service.ts` | Authenticated CRM client lookup               |
| `src/services/client-repair-order.service.ts` | Authenticated customer repair tracking        |
| `src/services/message-template.service.ts`    | Template CRUD, rendering, and logs            |
| `src/services/bot-notification.service.ts`    | Template and direct delivery through Telegram |
| `src/services/repair-order.service.ts`        | Public catalog and repair-order API           |
| `src/services/unknown-client.store.ts`        | Declined-user PostgreSQL upsert               |
| `src/api/server.ts`                           | Health endpoint                               |
| `src/config/index.ts`                         | Environment validation                        |

## Upstream API Behavior

Client registration calls:

```http
POST /api/v1/users/register-client
Authorization: Basic ...
```

Client repair tracking calls:

```http
GET /api/v1/telegram/clients/{client_id}/repair-orders?limit=10&offset=0
GET /api/v1/telegram/clients/{client_id}/repair-orders/{order_number}
POST /api/v1/repair-orders/register-comment/{repair_order_id}
Authorization: Basic ...
```

The detail response includes `final_problems[]`; each finalized problem carries its own
`warranty_period` in months and any assigned repair parts. The bot renders those per-problem
warranty periods in the customer repair-order card and keeps the older order-level warranty object
only as compatibility/expiry metadata.

Employee status-name sync calls:

```http
GET /api/v1/external/repair-order-statuses
Authorization: Basic ...
```

Catalog and repair-request calls:

```http
GET  /api/v1/calculator/os-types
GET  /api/v1/calculator/phone-categories/{os_type_id}
GET  /api/v1/calculator/problem-categories/{phone_category_id}
POST /api/v1/repair-orders/open
```

Registration, client repair tracking, and catalog reads retry bounded maintenance or availability
failures with exponential backoff. Registration returns only compact identity data and never embeds
repair orders. Client registration treats any `is_admin=true` response as an employee session; all
other successful registration responses are client sessions. Public repair-order creation is
intentionally attempted once because the upstream endpoint is not idempotent and a retry can create
a duplicate order.
Support comment submission is also attempted once by the bot. The CRM endpoint deduplicates
identical successful submissions for a short window and returns `created=false` for duplicates.
After a client starts `Xodimga yozish` / `Написать сотруднику` from an order detail card, the bot
keeps only the end-chat reply button visible and routes each text or supported photo message to CRM
until the client explicitly ends the chat.

See:

- `Docs/TELEGRAM_CLIENT_REGISTRATION_API.md`
- `Docs/TELEGRAM_CLIENT_REPAIR_ORDERS_API.md`
- `Docs/REPAIR_ORDER_STATUS_CATALOG_API.md`
- `Docs/PUBLIC_REPAIR_ORDER_AND_CALCULATOR_API_REFERENCE.md`

## Database And Migrations

The local `users` table stores Telegram identity, blocked-bot status, and the latest phone/locale
seen by the bot.
`telegram_id` identifies the Telegram account and is the unique upsert key. Registered users are
classified into exactly one role table: `employees` when CRM returns `is_admin=true`, otherwise
`clients`. Both role tables reference `users.id` through `user_id` and cascade on user deletion.
Unknown clients who decline the repair offer or cancel during final confirmation are still upserted
into `users` with the latest decline metadata. Regular registration still keys users by
`telegram_id`; support-message rows additionally store Telegram chat/message IDs so CRM replies can
later be sent as real Telegram replies to the original client message.

`message_templates` stores Uzbek and Russian Telegram template bodies, template metadata, active
status, and a unique template key. `message_dispatch_logs` records template and direct API send
attempts as `sent`, `failed`, or `template_not_found`. The notification dispatcher marks users as
blocked when Telegram returns a blocked-bot error and clears that flag after successful delivery or
when a known user is saved again.

`api_error_localizations` stores Developer-managed Uzbek/Russian messages keyed by bot endpoint and
the upstream error envelope's `location` token. The endpoint registry is code-owned so stored
localizations stay tied to APIs this bot actually uses.

`support_messages` stores each client support message accepted by CRM with the returned CRM comment
ID, repair-order context, Telegram chat/message IDs, content type, text, and photo count. The direct
message API can use this durable mapping to send CRM employee responses as threaded Telegram replies
when `support_reply.target_crm_comment_id` is provided.

`repair_order_status_names` stores the latest CRM repair-order status-name snapshot, CRM response
order, and employee-managed Uzbek/Russian display names by CRM status ID. Refreshes update CRM
names and ordering without overwriting the employee-managed display names.

`deployment_history` stores production deploy stop/start records. It captures exact database-server
timestamps for `stopped_at` and `started_at`, the computed shutdown period, current Git commit SHA,
full Git commit message, status, and an operational note.

`users.should_restart` is a durable deployment gate. It defaults to `false`, is set to `true` only
when `deploy.sh up` detects a different commit from the previous healthy deployment, and is cleared
for one user when that user sends `/start`.

This deploy-targeted schema change uses a forward migration because editing the original `users`
migration would not update an existing persistent database. Disposable pre-production databases may
still be recreated when explicitly chosen; shared or production applied migrations are immutable.

## Tests

Tests use injected HTTP clients, Fastify injection, temporary log directories, and a Knex-shaped
test double. They do not require live Telegram, CRM, or PostgreSQL services.

Current coverage includes:

- configuration parsing
- health API
- Developer endpoint localization flow
- direct message API validation and response mapping
- Uzbek phone normalization
- CRM request authentication and retries
- repair API paths, payloads, and retry safety
- repair flow formatting and pagination
- message-template rendering and notification dispatch behavior
- registered-user client/employee upsert behavior
- unknown-client upsert behavior
- logger output and level gating

## Logs

Every process run writes to a file under `logs/` named approximately:

```text
YYYY-MM-DD_HH-mm.log
```

`info`, `warn`, and `error` are always active. `debug` is enabled in development or with
`LOG_LEVEL=debug|extra-high`. `extra-high` also enables sanitized Telegram, CRM registration,
customer repair tracking, and public repair API request/response diagnostics. Table output is
enabled in development or `extra-high`.

Do not log bot tokens, passwords, authorization headers, or unnecessary personal data.

## Known Limitations

- Sessions are in memory and disappear on restart.
- Multiple replicas cannot share session state.
- Registered client identity remains in the in-memory session; repair orders are fetched on demand.
- Template management is available to CRM-recognized employees, but there is still no separate web
  admin panel.
- The bot uses long polling, not webhooks.
- Private-chat operation is assumed by the data model but is not enforced by a global chat-type
  guard.
- Repair-order creation has no client-provided idempotency key.
- Tests do not currently include live PostgreSQL or full Telegram update integration.
- Legacy documents under `Docs/` may describe broader systems not implemented in this repository.

Read `AGENTS.md` before making changes. It defines documentation precedence, coding conventions,
flow invariants, migration policy, testing expectations, and completion checks.
