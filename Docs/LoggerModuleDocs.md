# Logger Module Technical Documentation

This document provides an in-depth technical analysis and comprehensive guide to the custom logging system implemented in the **Probox Telegram Bot** application.

---

## 1. Overview and Architecture

The application uses a custom-built, lightweight logging utility wrapper designed to unify console output and session-based persistent file logs. Rather than relying on heavy external logging packages (like Winston or Pino), this utility optimizes node-native capabilities (`console` outputs and `util.inspect` formatting) coupled with asynchronous, non-blocking file appending.

### Key Architectural Pillars
1. **Unified Interface**: Same log messages are processed and outputted to both the terminal stdout/stderr (with colors/formatting) and the current log session file (stripped of formatting).
2. **Session-Bound File Lifetime**: A new, unique log file is initialized whenever the process boots up. All log messages within that run-time session are appended to the same file.
3. **Deep Object Inspection**: Avoids generic object serialization issues (e.g., `[object Object]` or default 2-level depth clipping in `console.log`) by recursively expanding objects of any depth.
4. **ANSI Strip Logic**: Color codes used for clean, human-readable terminal output are dynamically stripped out before being written to disk files.
5. **Recursion Safety**: If the file writer encounters a system failure (like a disk full error or write permissions issue), it bypasses itself and writes directly to `process.stderr` to avoid infinite recursion.

---

## 2. Directory Map

The logging system is spread across configuration, core utilities, and integration layers:

* **Configuration**:
  * [src/config/index.ts](file:///d:/Shakhzod/Javascript/Probox_TelegramBot/src/config/index.ts#L77) defines the global `LOG_LEVEL` option.
* **Core Logger**:
  * [src/utils/logger.ts](file:///d:/Shakhzod/Javascript/Probox_TelegramBot/src/utils/logger.ts) is the core module hosting formatters, file logic, and export definitions.
* **Grammy Bot Middleware**:
  * [src/middlewares/logger.middleware.ts](file:///d:/Shakhzod/Javascript/Probox_TelegramBot/src/middlewares/logger.middleware.ts) intercepts incoming Telegram bot updates and logs execution latency.
* **Fastify Server Integration**:
  * [src/api/errors/error-handler.ts](file:///d:/Shakhzod/Javascript/Probox_TelegramBot/src/api/errors/error-handler.ts#L41) hooks uncaught HTTP router exceptions to the logger.
* **Error Notifications**:
  * [src/services/error-notification.service.ts](file:///d:/Shakhzod/Javascript/Probox_TelegramBot/src/services/error-notification.service.ts) logs fallback alerts when standard Telegram notifications fail.
* **Application Bootstrap / Shutdown**:
  * [src/server.ts](file:///d:/Shakhzod/Javascript/Probox_TelegramBot/src/server.ts) and [src/app/bootstrap.ts](file:///d:/Shakhzod/Javascript/Probox_TelegramBot/src/app/bootstrap.ts) trace the lifecycle logs during start-up, crashes, and graceful shutdowns.

---

## 3. Configuration and Levels

The logging behavior is driven by two main environment variables parsed in the configuration utility:

* `NODE_ENV`: Sets the environment (e.g., `'development'`, `'production'`).
* `LOG_LEVEL`: Sets the granularity of output. Supported values are `'info'`, `'debug'`, and `'extra-high'`. Defaults to `'info'`.

### Behavior & Visibility Matrix

Depending on the environment and log level configured, different methods are resolved:

| Method | Log Level Threshold / Condition | Output Dest. (Console) | Output Dest. (File) | Description |
| :--- | :--- | :--- | :--- | :--- |
| **`logger.info(...)`** | Always active | `console.info` (stdout) | Active session log file | General informational messages about operations. |
| **`logger.warn(...)`** | Always active | `console.warn` (stderr) | Active session log file | Warnings regarding non-fatal discrepancies. |
| **`logger.error(...)`** | Always active | `console.error` (stderr) | Active session log file | Caught/uncaught runtime exceptions. |
| **`logger.debug(...)`** | `isDevelopment` OR `LOG_LEVEL === 'debug'` OR `LOG_LEVEL === 'extra-high'` | `console.debug` (stdout) | Active session log file | Low-level developer logs and debug context. |
| **`logger.table(...)`** | `isDevelopment` OR `LOG_LEVEL === 'extra-high'` | `console.table` (stdout) | Active session log file (as serialized JSON) | Visual arrays/objects mapping in development. |

---

## 4. Deep-Dive Core Implementation Analysis

The following sections dissect the core mechanisms implemented inside [src/utils/logger.ts](file:///d:/Shakhzod/Javascript/Probox_TelegramBot/src/utils/logger.ts).

### 4.1 Log Directory & Session File Generation
At module initialization, the logger creates a persistent `logs/` directory at the project root using a blocking recursive call if it doesn't already exist:
```typescript
const LOGS_DIR = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}
```

The logger determines the current session log filename via a self-invoking function (`SESSION_LOG_FILE`).
```typescript
const SESSION_LOG_FILE = (() => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = now.toISOString().slice(0, 10);           // "YYYY-MM-DD"
  const hour = pad(now.getHours());
  const minute = pad(now.getMinutes());
  return path.join(LOGS_DIR, `${date}_${hour}-${minute}.log`);
})();
```

> [!NOTE]
> **Timezone Nuance**: The filename matches a hybrid format where the date portion `date` uses the **UTC** timeline (from `.toISOString()`), while the `hour` and `minute` parts use the **local server timezone** (from `.getHours()` / `.getMinutes()`).

### 4.2 Non-Blocking Output & Self-Protection (Recursion Guard)
When logs are written to the filesystem, the logger avoids blocking the single-threaded Node.js event loop by writing asynchronously:
```typescript
const writeToFile = (line: string): void => {
  const cleanLine = stripAnsi(line);
  fs.appendFile(SESSION_LOG_FILE, cleanLine + '\n', 'utf8', (err) => {
    if (err) {
      // Avoid infinite recursion – write directly to stderr
      process.stderr.write(`[LOGGER] Failed to write to log file: ${err.message}\n`);
    }
  });
};
```
If `fs.appendFile` fails (e.g. disk quota exceeded or permissions revoked), executing `logger.error` within the callback would trigger another `writeToFile`, triggering an infinite recursion loop until stack overflow. To bypass this, the logger prints the failure warning directly to the low-level `process.stderr` stream.

### 4.3 ANSI Stripping
Terminal colors are added via ANSI control characters which break text alignment and readability when viewed in plain-text file editors. The logger removes these sequences using a regular expression:
```typescript
const stripAnsi = (str: string): string =>
  str.replace(/\u001B\[[0-9;]*m/g, '');
```

### 4.4 Argument Inspection & Formatting
Standard console methods dump deep objects by placing `[Object]` placeholders in nested trees. The logger mitigates this by formatting arguments through `util.inspect`:
```typescript
const formatArgs = (args: unknown[]): string[] => {
  return args.map(arg => {
    if (typeof arg === 'object' && arg !== null) {
      return util.inspect(arg, { depth: null, colors: true, showHidden: false });
    }
    return String(arg);
  });
};
```
* `depth: null`: Forces deep objects to be fully traversed and serialized without clipping.
* `colors: true`: Directs Node.js to include ANSI terminal highlight sequences for terminal readability.
* The prefix, ISO timestamp, and message are concatenated to form the final logged line:
```typescript
const buildLine = (level: string, message: string, args: unknown[]): string => {
  const timestamp = new Date().toISOString();
  const extras = formatArgs(args);
  const parts = [`[${level}] ${timestamp} - ${message}`, ...extras];
  return parts.join(' ');
};
```

---

## 5. System Integrations

### 5.1 Telegram Bot Middleware (Grammy)
In [src/middlewares/logger.middleware.ts](file:///d:/Shakhzod/Javascript/Probox_TelegramBot/src/middlewares/logger.middleware.ts), the logger integrates with the Telegram Update pipeline. It logs execution benchmarks for updates:
```typescript
export const loggerMiddleware = async (ctx: BotContext, next: NextFunction) => {
  const start = Date.now();
  
  if (config.LOG_LEVEL === 'extra-high') {
    logger.debug(`Incoming update ${ctx.update.update_id}:`, ctx.update);
  }

  await next();
  const ms = Date.now() - start;
  logger.info(`Update ${ctx.update.update_id} processed in ${ms}ms`);
};
```
* **Performance Benchmark**: Every incoming update processed prints a latency report at the `info` level.
* **Payload Inspection**: If the log level is set to `'extra-high'`, the full incoming JSON payload (`ctx.update`) is serialized and written via `logger.debug`.

### 5.2 Fastify Server HTTP Router Errors
In [src/api/errors/error-handler.ts](file:///d:/Shakhzod/Javascript/Probox_TelegramBot/src/api/errors/error-handler.ts#L41), the logger acts as the catching repository for unhandled API router exceptions. 
```typescript
logger.error(`Unhandled API error on ${request.method} ${request.url}`, error);
```
This logs the HTTP method, targeted URL, and structural stack trace of the unhandled error, helping developers inspect backend API faults.

### 5.3 Error Notification Fallbacks
The bot features a notifications pipeline in [src/services/error-notification.service.ts](file:///d:/Shakhzod/Javascript/Probox_TelegramBot/src/services/error-notification.service.ts) to send structural HTML alerts directly to a Telegram group. If the Telegram notification system cannot deliver the message (e.g. because of network errors or bot blocks), the service falls back to the logger:
```typescript
static async notify(params: {
  api: Api<RawApi>;
  error: unknown;
  context: ErrorNotificationContext;
}): Promise<void> {
  const chatId = getNotificationChatId();
  if (!chatId) {
    logger.warn('[ERROR_NOTIFICATION] Skipped error alert because no notification chat is configured.');
    return;
  }

  try {
    await sendToNotificationChat(
      params.api,
      this.buildMessage({ error: params.error, context: params.context }),
    );
  } catch (notificationError) {
    logger.error('[ERROR_NOTIFICATION] Failed to send error alert', notificationError);
  }
}
```

### 5.4 Lifecycle Tracing
The logger records lifecycle events during bootstrap and shutdown phases:

* **Graceful Shuts**:
  During graceful teardowns (caught through `SIGINT` / `SIGTERM`), the shutdown lifecycle prints an `info` message before shutting down Fastify connections, stopping the bot updates, disconnecting Redis, and destroying database pools:
  ```typescript
  logger.info('Shutting down application...');
  ```
* **Abrupt Crashes**:
  During application startup or shutdown failures (caught in [src/server.ts](file:///d:/Shakhzod/Javascript/Probox_TelegramBot/src/server.ts#L12)), the logger writes critical traces to disk and terminal:
  ```typescript
  logger.error('Failed to start application', err);
  logger.error('Failed to shut down cleanly', error);
  ```

---

## 6. Best Practices for Developers

When extending or working with this codebase, observe the following guidelines:

1. **Avoid Over-logging Objects in Production**: Do not pass massive objects to `logger.info` or `logger.warn` unless absolutely necessary, as it bypasses the `LOG_LEVEL` filter and writes the full inspection output to disk.
2. **Utilize `logger.debug` for Diagnostic Metadata**: For diagnostic telemetry (like dumping API request responses, database outputs, and JSON payloads), use `logger.debug(message, payload)` to ensure these are filtered out in production.
3. **Trace Errors Structurally**: When logging caught exceptions, pass the `Error` instance directly as the second argument rather than logging only `error.message`. Passing the full error object ensures the stack trace gets inspected and recorded:
   * **Correct**: `logger.error("Failed database write", error);`
   * **Incorrect**: `logger.error("Failed database write: " + error.message);`
4. **Use Tabular Format in Scripts**: If you are creating utility CLI scripts in `src/scripts`, use `logger.table` to print readable columns. In production, this output is serialized as JSON in log files while maintaining formatting on local terminal buffers.
