# Mobile authentication through the separate Telegram bot

The mobile API owns auth sessions, OTP hashing/verification, CRM user linking and JWT/refresh tokens. Procare_TelegramBot owns Telegram polling, contact sharing and message delivery. The mobile API does not run polling, accept Telegram webhooks, or use a Telegram bot token.

## Configuration

Mobile `.env` (also passed explicitly by `compose.yaml`):

```dotenv
TELEGRAM_BOT_API_URL=https://bot-api.example.com
TELEGRAM_BOT_API_TOKEN=<same value as bot API_MESSAGE_SEND_TOKEN>
TELEGRAM_BOT_USERNAME=<existing bot username without @>
TELEGRAM_BOT_BASIC_AUTH_USER=<dedicated mobile callback username>
TELEGRAM_BOT_BASIC_AUTH_PASSWORD=<dedicated mobile callback password>
```

Bot `.env` (Compose already reads this file):

```dotenv
BOT_ENABLED=true
API_ENABLED=true
BOT_TOKEN=<existing Telegram bot token>
API_MESSAGE_SEND_TOKEN=<existing bot API Bearer token>
MOBILE_API_BASE_URL=https://mobile-api.example.com
MOBILE_API_BASIC_AUTH_USER=<same callback username as mobile>
MOBILE_API_BASIC_AUTH_PASSWORD=<same callback password as mobile>
```

Both base URLs are origins without `/api/v1`, paths, embedded credentials, query strings or fragments. Use HTTPS outside a trusted private network. The mobile username must not include a colon. Keep the bot's `CRM_BASE_URL` and existing `TELEGRAM_BOT_BASIC_AUTH_*` unchanged: they authenticate ordinary CRM features, not mobile callbacks.

Mobile production startup requires all five Telegram settings. Development/test can omit the integration, but partial configuration is rejected and OTP delivery fails closed without it. The bot's three `MOBILE_API_*` settings are optional as a complete group; all blank disables mobile auth without disabling other bot features. Never run a second poller for the same bot.

PostgreSQL, Redis and JWT settings remain required for mobile. Production still requires the existing SMS settings under startup validation even though Telegram auth does not use SMS. Existing CRM schema and mobile DML permissions must support user creation/linking; CRM owns any schema migrations. This integration adds no schema migration.

## Service contracts

### Mobile to bot: send OTP

`POST {TELEGRAM_BOT_API_URL}/internal/telegram/send-otp`

`Authorization: Bearer <TELEGRAM_BOT_API_TOKEN>`

```json
{ "chat_id": "123456789", "otp": "123456", "expires_in": 180 }
```

Success: HTTP 200 `{"status":"sent","message_id":123}`. The bot also supports `phone_number` instead of chat ID, `locale` (`uz` or `ru`), and a custom `message`; mobile uses the verified chat ID and lets the bot resolve locale.

Bot errors: 400 invalid request; 401 invalid Bearer token; 404 unknown chat; 409 blocked chat; 502 delivery failure; 503 delivery unavailable. Mobile only unlinks/falls back to contact linking for 404/409. Other failures, timeouts and malformed success bodies delete the pending OTP session and return HTTP 503 with `location: auth_otp_delivery`; they never claim OTP delivery. Delivery uses a 10-second timeout, no automatic retry, and no redirects.

### Bot to mobile: lookup session

`GET {MOBILE_API_BASE_URL}/api/v1/auth/session-status?session_token=<opaque token>`

The bot sends its dedicated mobile Basic credentials. This remains the existing public app polling endpoint: the opaque session token authorizes access; it is not converted to a Basic-only endpoint. The bot only proceeds for `PENDING_TELEGRAM`. Missing/expired sessions return 404. Verified responses contain app tokens, so never log session tokens or response bodies. GET retries use the existing CRM timeout/retry tuning, but the target and credentials are separate.

### Bot to mobile: verify contact

`POST {MOBILE_API_BASE_URL}/api/v1/internal/telegram/verify-contact`

`Authorization: Basic <base64(MOBILE_API_BASIC_AUTH_USER:MOBILE_API_BASIC_AUTH_PASSWORD)>`

```json
{
  "session_token": "sess_...",
  "telegram_user_id": 123456789,
  "telegram_chat_id": 123456789,
  "contact_phone": "+998901234567",
  "contact_user_id": 123456789
}
```

Success: HTTP 200 `{"success":true}`. Missing/invalid service credentials return 401 before verification. Invalid/expired session or phone mismatch returns 400; a contact not owned by the sender returns 403. The bot checks contact ownership before submission; mobile repeats ownership and phone/session validation. The bot does not retry this POST and rejects malformed success responses. Callback credentials are checked in constant time and are separate from app JWTs.

Mobile's former `/api/v1/internal/telegram/send-otp` and `/api/v1/internal/telegram/webhook` routes are removed. Only the bot exposes OTP delivery. Mobile public auth endpoint request/response shapes are unchanged.

## Manual acceptance test

1. Configure both services and restart/recreate their processes. Deploy the bot through its existing `deploy.sh` workflow. Ensure mobile can reach the bot API and the bot can reach mobile. A Compose `.env` change requires API container recreation, not just restarting it.
2. Check mobile `/health/ready` and bot `/health`. These do not prove an auth exchange; continue with a test account.
3. In mobile Swagger `/api/docs`, call `POST /api/v1/auth/request-otp` with `{"phone_number":"+998901234567"}` using your own Telegram number.
4. For `REQUIRES_TELEGRAM_LINK`, open the returned deep link, start the existing bot and share your own matching contact within five minutes. Poll `/api/v1/auth/session-status?session_token=...`; expect `VERIFIED`, `access_token` and `refresh_token`. Contact sharing completes first-time auth without typing an OTP.
5. The bot removes its contact keyboard and tells the user to return to the app. There is no unsupported `procare://` Telegram inline button; app polling completes the transition.
6. After the 60-second cooldown, repeat the request. A linked user receives a six-digit OTP in the same bot. Submit `{"session_token":"sess_...","otp":"123456"}` to `/api/v1/auth/verify-otp` within 180 seconds.
7. Use the returned JWT as Bearer auth for `/api/v1/users/me`; test `/api/v1/auth/refresh` with `{"refresh_token":"..."}`. Access tokens last 15 minutes; refresh tokens last 90 days.
8. Verify wrong/missing callback Basic credentials yield 401; a different Telegram contact phone is rejected; wrong OTP consumes an attempt. Maximum five OTP attempts, three phone requests per 15 minutes, 60 seconds between requests, and ten requests per IP per minute.
9. Check the bot's normal menu, repair orders and CRM registration still work with their existing CRM configuration.

A bot restart loses an in-progress contact conversation because bot session state is in memory; reopen the pending link or request a new session. Credentials are not supplied by this change, no production services are deployed, and local mocked tests do not establish live connectivity.
