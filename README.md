# Procare Telegram Bot

Core Telegram bot service for registering existing Procare CRM clients by phone number and showing
their repair orders.

## Run locally

1. Copy `.env.example` to `.env` and fill in the Telegram and CRM credentials.
2. Configure the PostgreSQL connection variables in `.env`.
3. Install dependencies with `npm install`.
4. Run `npm run dev`.

Database migrations run automatically during application startup.

The health endpoint is available at `GET /health` on `API_PORT` (default `3000`).

## Commands

- `npm run dev` - run the bot in watch mode
- `npm run build` - compile TypeScript
- `npm test` - run unit tests
- `npm run check` - typecheck, lint, and test

## Current foundation

- grammY long-polling bot with session state
- Uzbek and Russian registration/menu flows
- shared-contact ownership validation
- CRM registration API client with Basic Auth and bounded retries
- unknown-client repair request flow with catalog pagination and problem selection
- PostgreSQL persistence for users who decline a repair request
- repair-order list formatting
- Fastify health endpoint
- session log files and graceful shutdown

The current session store is in memory. Production persistence (Redis or a database-backed session
adapter) should be connected before horizontal scaling.

Unknown clients who decline are upserted into the PostgreSQL `users` table by Telegram user ID.
