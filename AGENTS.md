# AGENTS.md

## Purpose

This file is the repository-specific operating guide for coding agents and contributors working on
`procare-telegram-bot`. Follow it for implementation, review, testing, and documentation work.

The project is a focused TypeScript service. It is not the larger historical Probox bot described
by some files under `Docs/`. Prefer the current repository, tests, and configuration over copied or
generated reference documents.

## Source Of Truth

Use this precedence when information conflicts:

1. Current source code and database migrations under `src/`.
2. Automated tests under `tests/`.
3. `package.json`, `.env.example`, `Dockerfile`, and `docker-compose.yml`.
4. This file and `README.md`.
5. Active upstream API contracts:
   - `Docs/TELEGRAM_CLIENT_REGISTRATION_API.md`
   - `Docs/PUBLIC_REPAIR_ORDER_AND_CALCULATOR_API_REFERENCE.md`
6. Historical, generated, or blueprint documents under `Docs/`.

The two API references describe the upstream CRM service consumed by this repository. They are
contract references, not local server routes. If an upstream contract changes, update the
corresponding service, runtime validators, types, tests, and documentation together.

Treat these documents as non-authoritative background:

- `Docs/ARCHITECTURE_TEMPLATE.md` describes a much larger historical Probox repository with files,
  commands, modules, and dependencies that are absent here.
- `Docs/POSTGRES_ARCHITECTURE_REPORT.md` is a snapshot of a different, larger database. It does not
  describe the schema created by this service.
- `Docs/TemplateMessagesSystemGuide.md` is an implementation blueprint. The template, dispatch,
  admin, coupon, and conversation systems it describes are not implemented here.
- `Docs/LoggerModuleDocs.md` contains useful logger concepts, but several paths and integrations are
  from the larger application. `src/utils/logger.ts` and `tests/logger.test.ts` are authoritative.

Do not recreate legacy modules merely because they appear in those documents.

## Project Snapshot

- Runtime: Node.js 20 or newer. Docker uses Node.js 22 Alpine.
- Language: TypeScript with strict checking and NodeNext module resolution.
- Bot framework: grammY using long polling.
- HTTP server: Fastify, currently exposing only `GET /health`.
- Database: PostgreSQL through Knex.
- External service: Procare CRM/public repair API over HTTP.
- Tests: Node's built-in test runner with `tsx`.
- Formatting: Prettier.
- Linting: ESLint with type-aware TypeScript rules.
- Session storage: grammY in-memory sessions.
- Supported bot locales: Uzbek (`uz`) and Russian (`ru`).

The application can enable or disable the Telegram bot and health API independently, but startup
always validates CRM and database configuration, connects to PostgreSQL, and runs migrations.

## Repository Map

| Path                                          | Responsibility                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `src/server.ts`                               | Process entry point, configuration, logger creation, signal handling    |
| `src/app/bootstrap.ts`                        | Dependency construction, migrations, bot/API startup, graceful shutdown |
| `src/config/index.ts`                         | Environment parsing, defaults, bounds, and aggregate validation         |
| `src/api/server.ts`                           | Fastify health API and API-level error handler                          |
| `src/bot/create-bot.ts`                       | Telegram commands, messages, callbacks, and flow orchestration          |
| `src/bot/context.ts`                          | Session state and repair-request draft types                            |
| `src/bot/messages.ts`                         | All user-facing Uzbek and Russian message strings                       |
| `src/bot/keyboards.ts`                        | Reply and inline keyboard construction                                  |
| `src/bot/formatters.ts`                       | Repair-order and repair-request presentation                            |
| `src/services/client-registration.service.ts` | Authenticated CRM client lookup                                         |
| `src/services/repair-order.service.ts`        | Public catalog reads and repair-order creation                          |
| `src/services/registered-user.store.ts`       | PostgreSQL upsert for registered client and employee role rows          |
| `src/services/unknown-client.store.ts`        | PostgreSQL upsert for declined unknown clients                          |
| `src/database/database.ts`                    | Knex connection and migration runner                                    |
| `src/database/migrations/`                    | Local application schema                                                |
| `src/types/`                                  | External contract and persistence types                                 |
| `src/utils/phone.ts`                          | Uzbek phone normalization                                               |
| `src/utils/html.ts`                           | Telegram HTML escaping                                                  |
| `src/utils/logger.ts`                         | Console and per-process file logging                                    |
| `tests/`                                      | Unit and component-level tests with injected dependencies               |
| `Docs/`                                       | Upstream contracts plus legacy/reference material                       |
| `dist/`                                       | Generated TypeScript output; never edit                                 |
| `logs/`                                       | Generated runtime logs; never commit                                    |

## Runtime Lifecycle

Startup is intentionally ordered:

1. `src/server.ts` loads and validates all configuration.
2. The logger creates the `logs/` directory and chooses a session log file.
3. `bootstrap` creates the PostgreSQL client.
4. Knex runs all pending migrations.
5. CRM gateway, repair-order gateway, and unknown-client store instances are created.
6. When enabled, the bot authenticates with Telegram via `bot.init()`.
7. When enabled, Fastify starts listening.
8. The bot starts long polling.

If migrations fail, the database pool is destroyed and startup fails. The HTTP health endpoint is
not a database or CRM readiness check; it reports process-level service status and whether the bot
is configured as enabled.

Shutdown handles `SIGINT` and `SIGTERM` once. It stops bot polling, waits for polling completion,
closes Fastify, destroys the database pool, and then exits.

Keep startup and shutdown changes symmetric. Any new long-lived resource must be created in
`bootstrap` and closed in `RunningApplication.stop()`.

## Telegram Flow

The bot is a stateful private-chat experience:

1. A new session starts in Uzbek at `choosing_language`.
2. `/start` asks an unregistered user to choose Uzbek or Russian.
3. The selected language moves the session to `awaiting_phone`.
4. The user must share a Telegram contact owned by the same Telegram user
   (`contact.user_id === ctx.from.id`).
5. The phone is normalized to `+998XXXXXXXXX`.
6. The CRM registration endpoint looks up an active client.
7. A `200 OK` response is persisted into PostgreSQL as an employee when `is_admin = true`; otherwise
   it is persisted as a client.
8. A known non-admin client is held in session and can view the repair orders returned by that
   lookup.
9. An active admin is held as an admin-only session and is not offered client repair orders or
   unknown-client repair creation.
10. A `404` starts the unknown-client repair-request flow.
11. The user chooses OS, navigates paginated category levels, selects zero or more problems, adds an
    optional note, reviews the request, and submits or cancels it.
12. Declining the initial offer or cancelling at confirmation upserts the user into PostgreSQL.

The stage union in `src/bot/context.ts` and the checks in every handler protect against stale inline
buttons. New flow states must be added to the session type, assigned deliberately, and rejected by
unrelated handlers.

Important behavior:

- `/start` does not refresh an already registered client's CRM data. It reuses the profile held in
  the current session.
- Repair orders shown in the menu are the orders returned during registration. They are not fetched
  again when the user presses the orders button.
- Session data is lost on process restart and is not shared across replicas.
- Callback payloads use array indices for the current session's catalog data. Do not resolve an
  index without validating the current stage, draft, and selected item.
- Category pages contain 10 items. Number buttons must stay aligned with the displayed list.
- A repair request may have no selected predefined problems; the note can carry the free-text issue.
- The assembled description sent upstream must remain at or below 10,000 characters.
- The current persistence model intentionally stores `telegram_id`, not a separate chat ID, because
  the bot is designed for private user chats.
- The bot does not currently reject non-private chat types in middleware. If private-only operation
  must be enforced rather than assumed operationally, add an explicit chat-type guard and tests.

When changing a flow, update session types, handler guards, messages, keyboards, formatters, and
tests as one change. Avoid introducing user-facing text directly inside handlers when it belongs in
`messages.ts`.

## External API Contracts

### Client Registration

`HttpClientRegistrationService` calls:

```text
POST {CRM_BASE_URL}/api/v1/users/register-client
Authorization: Basic <configured service credentials>
Content-Type: application/json
```

Request:

```json
{ "phone_number": "+998XXXXXXXXX" }
```

Behavior:

- Normalize the phone before sending.
- Never log the Basic Auth password or complete authorization header.
- Use `is_admin` to distinguish employee and client `200 OK` responses.
- Map `400` to `invalid_phone`, `401` to `unauthorized`, `404` to `not_found`, and `503` to
  `maintenance`.
- Treat `500`, network failures, and other HTTP failures as `unavailable`.
- Retry only `maintenance` and `unavailable`, up to `CRM_MAX_RETRIES`, with 250 ms exponential
  backoff.
- Validate successful JSON before returning it. Do not blindly cast upstream responses.

### Catalog And Public Repair Orders

`HttpRepairOrderService` calls these unauthenticated upstream endpoints:

```text
GET  /api/v1/calculator/os-types
GET  /api/v1/calculator/phone-categories/{osTypeId}
GET  /api/v1/calculator/phone-categories/{osTypeId}?parent_id={parentId}
GET  /api/v1/calculator/problem-categories/{phoneCategoryId}
POST /api/v1/repair-orders/open
```

Rules:

- Encode path identifiers and build query strings with `URLSearchParams`.
- Treat decimal values such as `price`, `cost`, and `total` as strings.
- A calculator `200 []` is a valid empty state.
- Retry only GET catalog reads after maintenance or availability failures.
- Never automatically retry `POST /repair-orders/open`. The upstream endpoint is not idempotent,
  and a retry can create a duplicate repair order.
- Map `400`, `409`, and `422` to `invalid_request`; `429` to `rate_limited`; `503` to
  `maintenance`; other failures to `unavailable`.
- Keep runtime response validators synchronized with `src/types/repair-order.ts` and the upstream
  contract. Add tests for rejected malformed responses when validators change.

Do not add Basic Auth to the public calculator or repair-order endpoints unless the upstream
contract changes.

## Database Rules

The local database currently owns three application tables: `users`, `clients`, and `employees`,
plus Knex migration metadata. `users.telegram_id` is the unique Telegram identity used for upserts.
`clients.user_id` and `employees.user_id` reference `users.id`.

The unknown-client store persists:

- Telegram user identity and optional username;
- first and optional last name;
- normalized phone number;
- selected locale;
- the latest decline reason;
- decline, creation, and update timestamps.

Current decline reasons are:

- `declined_offer`
- `cancelled_confirmation`

Use Knex query building and parameter binding. Do not concatenate SQL from user input.

### Migration Policy

The repository is currently pre-production and documented as having no real user data. Under that
explicit condition:

- Edit the original migration for an existing table instead of adding a chain of corrective
  alteration migrations.
- Add a new migration file when introducing a new table.
- Keep both `up` and `down` paths valid.
- Update store code, record types, tests, `.env.example` when relevant, and documentation in the
  same change.

This policy must change once a shared or production database contains durable data. From that point,
applied migrations are immutable and every schema change requires a forward migration.

Editing an already-applied migration does not update an existing local database. In a disposable
development environment, recreate the database or Docker volume and restart so migrations run
against an empty schema. Never destroy a database unless the environment is confirmed disposable.

Do not derive this service's schema from `Docs/POSTGRES_ARCHITECTURE_REPORT.md`.

## Configuration

`.env.example` is the public inventory of supported environment variables. Keep it synchronized
with `AppConfig` and `loadConfig`.

| Variable                           | Required/default          | Notes                                                     |
| ---------------------------------- | ------------------------- | --------------------------------------------------------- |
| `NODE_ENV`                         | `development`             | `development`, `test`, or `production`                    |
| `LOG_LEVEL`                        | `info`                    | `info`, `debug`, or `extra-high`                          |
| `BOT_ENABLED`                      | `true`                    | Strict lowercase boolean                                  |
| `BOT_TOKEN`                        | Required when bot enabled | Telegram bot token; secret                                |
| `BOT_USERNAME`                     | Optional                  | Parsed for configuration; currently not used at runtime   |
| `API_ENABLED`                      | `true`                    | Strict lowercase boolean                                  |
| `API_HOST`                         | `0.0.0.0`                 | Fastify listen host                                       |
| `API_PORT`                         | `3000`                    | Integer from 1 through 65535                              |
| `CRM_BASE_URL`                     | Required                  | Trailing slashes are removed                              |
| `TELEGRAM_BOT_BASIC_AUTH_USER`     | Required                  | CRM service credential                                    |
| `TELEGRAM_BOT_BASIC_AUTH_PASSWORD` | Required                  | CRM service secret                                        |
| `CRM_REQUEST_TIMEOUT_MS`           | `10000`                   | Integer from 100 through 120000                           |
| `CRM_MAX_RETRIES`                  | `2`                       | Integer from 0 through 5                                  |
| `DB_HOST`                          | `localhost`               | Overridden to `postgres` by Compose for the bot container |
| `DB_PORT`                          | `5432`                    | Integer from 1 through 65535                              |
| `DB_USER`                          | `postgres`                | PostgreSQL user                                           |
| `DB_PASS`                          | Required                  | PostgreSQL password; secret                               |
| `DB_NAME`                          | `probox_bot_db`           | PostgreSQL database                                       |
| `DB_SSL`                           | `false`                   | Uses `rejectUnauthorized: false` when enabled             |
| `DB_POOL_MIN`                      | `0`                       | Integer from 0 through 100                                |
| `DB_POOL_MAX`                      | `10`                      | Integer from 1 through 100; must be at least pool min     |
| `DB_ACQUIRE_TIMEOUT_MS`            | `10000`                   | Integer from 100 through 120000                           |

Configuration validation aggregates issues into one `ConfigurationError`. Preserve that behavior so
operators can fix all invalid settings in one pass.

Never read or expose values from `.env` in logs, tests, documentation, or commits. Use synthetic
credentials in tests.

## TypeScript And Module Conventions

- Keep strict TypeScript enabled.
- Respect `noUncheckedIndexedAccess`; validate array lookups and regex captures before use.
- Use `import type` for type-only imports. ESLint enforces this.
- Source imports use `.js` extensions even though source files are `.ts`; this is required by
  NodeNext output.
- Prefer explicit return types on exported functions and meaningful public interfaces.
- Keep external contract types in `src/types/`, session types in `src/bot/context.ts`, and service
  interfaces next to their implementations.
- Inject `fetchImpl`, `sleep`, storage, and logger dependencies where testability benefits.
- Use `unknown` at error and network boundaries, then narrow it.
- Do not suppress floating promises. Intentionally detached promises must use `void` and have an
  error path.
- Use `URL`, `URLSearchParams`, `Headers`, and `Response` APIs instead of manual HTTP string parsing.
- Keep changes scoped. Do not introduce a framework, ORM, validation library, or abstraction unless
  the current code has a concrete need for it.

## Telegram Presentation And Localization

- Put reusable user-visible strings in both locale branches of `src/bot/messages.ts`.
- Keep `MessageKey` parity by adding the same key to Uzbek and Russian.
- Preserve Telegram button labels used by `bot.hears`; changing a label changes routing behavior.
- Use `parse_mode: 'HTML'` only when required.
- Escape all user-controlled and upstream-controlled values included in HTML messages with
  `escapeHtml`.
- Do not escape the complete message after adding intentional markup; escape interpolated values.
- Keep callback data short and stable within Telegram limits.
- Answer callback queries before doing longer work so Telegram clients stop showing the loading
  state.
- Validate stale callbacks rather than assuming session state exists.

When changing copy, preserve meaning across Uzbek and Russian and verify keyboard widths and message
lengths. This repository does not currently use the database-backed message-template system
described in `Docs/TemplateMessagesSystemGuide.md`.

## Logging And Error Handling

Use the injected `Logger` interface rather than raw console methods in application modules. The
logger writes to the console and asynchronously appends to one file per process session.

- `info`: lifecycle and successful operation summaries.
- `warn`: recoverable degradation and retry notices.
- `error`: failed operations with the original error object.
- `debug`: diagnostic detail gated by environment/log level.
- `table`: development or `extra-high` diagnostics only.

Do not log:

- bot tokens, passwords, authorization headers, or full environment objects;
- full Telegram contact payloads;
- unnecessary phone numbers or CRM profiles;
- large upstream response bodies at `info` level.

Map technical failures to localized user messages at the bot boundary. Preserve structured service
error codes so handlers can distinguish not-found, maintenance, rate-limit, validation, and
availability cases.

## Testing Strategy

Use the existing Node test runner style:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
```

Tests currently cover:

- configuration parsing and required settings;
- health endpoint response;
- Uzbek phone normalization;
- CRM authentication, normalization, and retry behavior;
- repair API URL construction, payloads, and retry policy;
- formatter and keyboard pagination behavior;
- unknown-client PostgreSQL upsert behavior;
- logger routing, persistence, ANSI stripping, and level gating.

The suite uses injected `fetch`, sleep functions, Fastify injection, temporary directories, and a
Knex-shaped test double. It does not require Telegram, CRM, or PostgreSQL to be live.

For changes:

- Add a regression test for every bug fix.
- Add success, boundary, and failure cases for config or input validation changes.
- Test retry count and delay behavior without real sleeps.
- Assert POST repair-order creation remains single-attempt.
- Test both locales when changing formatters or localized behavior.
- Test database payload and conflict keys when changing persistence.
- Prefer deterministic dates and injected dependencies.
- Do not make unit tests depend on `.env`, network access, execution order, or an existing `logs/`
  directory.

## Commands

Use `npm ci` for a clean reproducible install when `package-lock.json` is available. Use
`npm install` when intentionally changing dependencies.

| Command                     | Purpose                                       |
| --------------------------- | --------------------------------------------- |
| `npm run dev`               | Run `src/server.ts` with watch/restart        |
| `npm run build`             | Compile source and tests to `dist/`           |
| `npm start`                 | Run compiled `dist/src/server.js`             |
| `npm run typecheck`         | Type-check without writing output             |
| `npm test`                  | Run all `tests/*.test.ts` files               |
| `npm run lint`              | Run ESLint over the repository                |
| `npm run format`            | Write Prettier formatting                     |
| `npm run format:check`      | Check Prettier formatting                     |
| `npm run check`             | Type-check, lint, and test                    |
| `docker compose up --build` | Build and run PostgreSQL plus the bot service |

Minimum verification for documentation-only changes:

```text
npm run format:check
```

Minimum verification for code changes:

```text
npm run check
npm run build
```

Also run `npm run format:check` when files covered by Prettier changed. If environment limitations
prevent a command, report exactly what was not run and why.

## Change Workflows

### Adding Or Changing A Bot Step

1. Update stage/session types.
2. Add or update localized messages.
3. Add keyboard or formatter behavior.
4. Implement the guarded handler transition.
5. Handle stale state and upstream failures.
6. Add focused tests.
7. Run check, build, and formatting validation.

### Changing An Upstream Contract

1. Confirm the active upstream API reference or implementation.
2. Update request construction and error mapping.
3. Update runtime validators and TypeScript types.
4. Add contract-shaped tests for success and malformed data.
5. Update the relevant file under `Docs/` and summarize the change in `README.md` if operator-facing.

### Changing Configuration

1. Update `AppConfig`.
2. Parse and validate the variable in `loadConfig`.
3. Add it to `.env.example`.
4. Pass it through bootstrap to the owning module.
5. Add valid, invalid, default, and boundary tests.
6. Update the environment table in this file and `README.md`.

### Changing The Database

1. Apply the migration policy above.
2. Update persistence types and store queries.
3. Add or update store tests.
4. Consider existing applied local migrations.
5. Document any reset or rollout requirement.

## Known Limitations

Do not accidentally present these as implemented features:

- Sessions are in memory, with no Redis or database-backed adapter.
- Horizontal scaling is unsafe because bot session state is process-local.
- A restart loses registration and in-progress repair-request state.
- The bot uses long polling, not webhooks.
- Private-chat operation is an architectural assumption, not an explicit global chat-type guard.
- The health endpoint does not verify PostgreSQL, Telegram, or CRM readiness.
- Registered client profiles and repair orders are cached only in session.
- There is no full Telegram update integration test suite.
- There is no live PostgreSQL integration test.
- There is no admin interface, broadcast system, coupon system, support flow, transactional template
  system, or scheduled job layer in this repository.
- Public repair-order creation has no client-provided idempotency key, so it must not be retried
  automatically.

## Completion Checklist

Before declaring a change complete:

- Read the current working tree and preserve unrelated user changes.
- Confirm behavior against source and tests, not legacy documentation.
- Keep secrets and personal data out of code, logs, fixtures, and docs.
- Update types, runtime validation, tests, and docs together when contracts change.
- Keep Uzbek and Russian messages aligned.
- Verify database migration implications.
- Run the applicable checks.
- Review `git diff` for generated files, unrelated edits, and accidental credential exposure.
- Summarize changed files, observable behavior, and verification results.
