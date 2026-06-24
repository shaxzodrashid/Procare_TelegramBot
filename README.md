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
       -> send a text or photo support comment from a selected order
  -> active CRM employee
       -> show employee-role confirmation
       -> manage transactional message templates
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
  "botEnabled": true
}
```

This is a process health endpoint. It does not actively probe PostgreSQL, Telegram, or CRM.

The direct message endpoint is:

```http
POST http://localhost:3000/messages/send
Content-Type: application/json
```

Request:

```json
{
  "phone_number": "+998901234567",
  "message": "Salom"
}
```

The API normalizes Uzbek phone numbers, finds the local `users` row by `phone_number`, and sends a
plain Telegram message to that user's `telegram_id`. It returns `404` when no local user matches,
`409` when the user is already marked as blocked, `502` when Telegram delivery fails, and `503` when
the Telegram bot is disabled so delivery is unavailable.

## Docker Compose

Create `.env`, then run:

```powershell
docker compose up --build
```

Compose starts:

- `postgres`: PostgreSQL 18 with a persistent named volume
- `bot`: the production image, with `DB_HOST` set to `postgres`

The bot container publishes `API_PORT` and mounts `./logs` at `/app/logs`.

When CRM runs on the host machine, do not leave `CRM_BASE_URL` as `http://localhost:5001` for the
container. Inside the bot container, `localhost` means the container itself. Use a reachable
Compose service name or a host address such as `host.docker.internal` where supported.

To stop the services:

```powershell
docker compose down
```

`docker compose down -v` also deletes the PostgreSQL volume and all data in it. Use that command
only for a confirmed disposable development database.

## Configuration

All supported variables are listed in `.env.example`.

| Variable                           | Default         | Requirement or purpose                     |
| ---------------------------------- | --------------- | ------------------------------------------ |
| `NODE_ENV`                         | `development`   | `development`, `test`, or `production`     |
| `LOG_LEVEL`                        | `info`          | `info`, `debug`, or `extra-high`           |
| `BOT_ENABLED`                      | `true`          | Enable Telegram bot startup                |
| `BOT_TOKEN`                        | none            | Required when `BOT_ENABLED=true`           |
| `BOT_USERNAME`                     | none            | Optional; currently not used at runtime    |
| `RICH_MESSAGES_ENABLED`            | `false`         | Rich order cards with HTML fallback        |
| `API_ENABLED`                      | `true`          | Enable the Fastify health API              |
| `API_HOST`                         | `0.0.0.0`       | API listen host                            |
| `API_PORT`                         | `3000`          | API listen port                            |
| `CRM_BASE_URL`                     | none            | Required CRM/API base URL                  |
| `TELEGRAM_BOT_BASIC_AUTH_USER`     | none            | Required CRM service username              |
| `TELEGRAM_BOT_BASIC_AUTH_PASSWORD` | none            | Required CRM service password              |
| `CRM_REQUEST_TIMEOUT_MS`           | `10000`         | Upstream request timeout                   |
| `CRM_MAX_RETRIES`                  | `2`             | Retry count for eligible upstream requests |
| `DB_HOST`                          | `localhost`     | PostgreSQL host                            |
| `DB_PORT`                          | `5432`          | PostgreSQL port                            |
| `DB_USER`                          | `postgres`      | PostgreSQL user                            |
| `DB_PASS`                          | none            | Required PostgreSQL password               |
| `DB_NAME`                          | `probox_bot_db` | PostgreSQL database                        |
| `DB_SSL`                           | `false`         | Enable PostgreSQL TLS                      |
| `DB_POOL_MIN`                      | `0`             | Minimum pool size                          |
| `DB_POOL_MAX`                      | `10`            | Maximum pool size                          |
| `DB_ACQUIRE_TIMEOUT_MS`            | `10000`         | Connection acquisition timeout             |

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

See:

- `Docs/TELEGRAM_CLIENT_REGISTRATION_API.md`
- `Docs/TELEGRAM_CLIENT_REPAIR_ORDERS_API.md`
- `Docs/PUBLIC_REPAIR_ORDER_AND_CALCULATOR_API_REFERENCE.md`

## Database And Migrations

The local `users` table stores Telegram identity, blocked-bot status, and the latest phone/locale
seen by the bot.
`telegram_id` identifies the Telegram account and is the unique upsert key. Registered users are
classified into exactly one role table: `employees` when CRM returns `is_admin=true`, otherwise
`clients`. Both role tables reference `users.id` through `user_id` and cascade on user deletion.
Unknown clients who decline the repair offer or cancel during final confirmation are still upserted
into `users` with the latest decline metadata. A separate chat ID is not stored because the bot
currently targets private user chats.

`message_templates` stores Uzbek and Russian Telegram template bodies, template metadata, active
status, and a unique template key. `message_dispatch_logs` records template and direct API send
attempts as `sent`, `failed`, or `template_not_found`. The notification dispatcher marks users as
blocked when Telegram returns a blocked-bot error and clears that flag after successful delivery or
when a known user is saved again.

While this project is pre-production and has no real user data, edit an existing table's original
migration instead of creating follow-up alteration migrations. Add a new migration file only when
introducing a new database table.

Once a shared or production database contains durable data, applied migrations must become
immutable and schema changes must use new forward migrations.

Changing an original migration does not update a database where that migration was already applied.
Recreate only a disposable local database or volume before restarting the application.

## Tests

Tests use injected HTTP clients, Fastify injection, temporary log directories, and a Knex-shaped
test double. They do not require live Telegram, CRM, or PostgreSQL services.

Current coverage includes:

- configuration parsing
- health API
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
- The health endpoint is not a dependency readiness check.
- Repair-order creation has no client-provided idempotency key.
- Tests do not currently include live PostgreSQL or full Telegram update integration.
- Legacy documents under `Docs/` may describe broader systems not implemented in this repository.

Read `AGENTS.md` before making changes. It defines documentation precedence, coding conventions,
flow invariants, migration policy, testing expectations, and completion checks.
