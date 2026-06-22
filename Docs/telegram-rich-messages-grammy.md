# Telegram Rich Messages in grammY

**Professional implementation guide for Telegram Bot API 10.1 rich text / rich messages**  
**Target stack:** Node.js, TypeScript, grammY  
**Last verified:** 2026-06-15

---

## 1. What this feature is

Telegram Bot API 10.1 introduced **Rich Messages** for bots. Rich Messages are not the same as classic `sendMessage` formatting with `parse_mode: "MarkdownV2"` or `parse_mode: "HTML"`.

Classic bot messages are mainly plain text plus inline formatting. Rich Messages are structured message documents. They can contain headings, lists, tables, block quotes, collapsible details, media blocks, footnotes, formulas, maps, slideshows, collages, and draft streaming for AI responses.

The core Bot API additions are:

| Bot API item | Purpose |
|---|---|
| `InputRichMessage` | The rich message payload sent by the bot. Exactly one of `markdown` or `html` must be used. |
| `sendRichMessage` | Sends a persistent rich message to a chat. |
| `sendRichMessageDraft` | Streams an ephemeral partial rich message while an AI answer is being generated. |
| `editMessageText` with `rich_message` | Edits an existing message into new rich content. |
| `Message.rich_message` | Rich content attached to received/sent message objects. |
| `InputRichMessageContent` | Rich content for inline query / Web App / guest-query style message results. |

Official references:

- Telegram Bot API: https://core.telegram.org/bots/api
- Telegram Bot API changelog: https://core.telegram.org/bots/api-changelog
- grammY API reference: https://grammy.dev/ref/core/api
- grammY Bot API guide: https://grammy.dev/guide/api
- grammY type declarations: https://github.com/grammyjs/types

---

## 2. Why it matters for AI chatbots

Rich Messages are especially useful for AI bots because model outputs are naturally document-like:

- long answers with sections;
- tables and comparison matrices;
- code blocks with language labels;
- step-by-step lists;
- citations or references;
- collapsible details;
- formulas in LaTeX;
- generated reports;
- temporary streaming previews while the final answer is being produced.

For example, instead of sending this as a normal MarkdownV2 message:

```text
Client Summary
Name: Ali Valiyev
Phone: +998...
Status: Waiting for operator
```

You can send a richer document:

```md
# Client Summary

| Field | Value |
|---|---|
| Name | Ali Valiyev |
| Phone | +998 90 123 45 67 |
| Status | Waiting for operator |

<details>
<summary>Operator notes</summary>

The client asks about cargo status and needs a human confirmation.

</details>
```

---

## 3. Production recommendation

Use Rich Messages as an **optional rendering mode**, not as the only output path.

Recommended strategy:

1. Keep your current `ctx.reply()` / `sendMessage()` implementation as the fallback.
2. Add a `RICH_MESSAGES_ENABLED=true` feature flag.
3. Use `sendRichMessage` for rich final answers when enabled.
4. Use `sendRichMessageDraft` only in private chats and only while generating the final AI response.
5. If rich sending fails, log the error and fall back to classic `sendMessage`.

This is safer because Rich Messages are a new client-facing rendering feature. Bot API support can be available before every Telegram client renders every block perfectly.

---

## 4. Environment setup

### 4.1 Install grammY

```bash
npm install grammy
npm install --save-dev typescript tsx @types/node
```

### 4.2 Keep grammY and types fresh

```bash
npm install grammy@latest @grammyjs/types@latest
```

Check what you have:

```bash
npm ls grammy @grammyjs/types
```

### 4.3 Recommended `package.json`

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx src/bot.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "grammy": "latest"
  },
  "devDependencies": {
    "@types/node": "latest",
    "tsx": "latest",
    "typescript": "latest"
  }
}
```

### 4.4 Recommended `.env`

```env
BOT_TOKEN=123456:ABCDEF
RICH_MESSAGES_ENABLED=true
RICH_DRAFTS_ENABLED=true
```

Never commit `.env` to Git.

---

## 5. grammY integration model

### 5.1 The reliable path: `ctx.api.raw`

grammY exposes the Telegram Bot API in two ways:

1. convenience methods, such as `ctx.reply()` or `ctx.api.sendMessage(chatId, text, options)`;
2. raw methods under `ctx.api.raw`, where the payload shape follows the official Bot API method one-to-one.

For a very new Bot API method, the most reliable implementation style is to call:

```ts
ctx.api.raw.sendRichMessage({
  chat_id: ctx.chat.id,
  rich_message: {
    markdown: "# Hello\n\nThis is a rich message.",
  },
});
```

This maps directly to the official `sendRichMessage` method.

### 5.2 Why `raw` is recommended first

Use `raw` because:

- it mirrors the Telegram Bot API docs directly;
- it avoids guessing grammY convenience method signatures;
- it is usually easier to adopt new Bot API methods;
- it works well with custom wrappers and feature flags.

---

## 6. Minimal working bot

Create `src/bot.ts`:

```ts
import { Bot } from "grammy";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is missing");

const bot = new Bot(token);

bot.command("start", async (ctx) => {
  await ctx.reply("Send /rich to test Telegram Rich Messages.");
});

bot.command("rich", async (ctx) => {
  if (!ctx.chat) return;

  await ctx.api.raw.sendRichMessage({
    chat_id: ctx.chat.id,
    rich_message: {
      markdown: `# Rich Message Test

Hello, **${ctx.from?.first_name ?? "there"}**.

| Feature | Status |
|---|---:|
| Headings | ✅ |
| Tables | ✅ |
| Lists | ✅ |

- One
- Two
- Three

<details>
<summary>More details</summary>

This content is inside a collapsible block.

</details>`,
    },
  });
});

bot.catch((err) => {
  console.error("Bot error:", err);
});

bot.start();
```

Run it:

```bash
BOT_TOKEN="123456:ABC" npm run dev
```

---

## 7. TypeScript-safe helper layer

A helper layer keeps rich-message logic out of handlers and gives you a clean fallback path.

Create `src/telegram-rich.ts`:

```ts
import type { Context, InlineKeyboard } from "grammy";
import type { Message } from "grammy/types";

export type InputRichMessageCompat = {
  html?: string;
  markdown?: string;
  is_rtl?: boolean;
  skip_entity_detection?: boolean;
};

export type SendRichMessageArgsCompat = {
  chat_id: number | string;
  message_thread_id?: number;
  direct_messages_topic_id?: number;
  rich_message: InputRichMessageCompat;
  disable_notification?: boolean;
  protect_content?: boolean;
  allow_paid_broadcast?: boolean;
  message_effect_id?: string;
  reply_parameters?: {
    message_id: number;
    chat_id?: number | string;
    allow_sending_without_reply?: boolean;
    quote?: string;
    quote_parse_mode?: string;
    quote_position?: number;
  };
  reply_markup?: unknown;
};

export type SendRichMessageDraftArgsCompat = {
  chat_id: number;
  message_thread_id?: number;
  draft_id: number;
  rich_message: InputRichMessageCompat;
};

type RawRichApiCompat = {
  sendRichMessage(args: SendRichMessageArgsCompat): Promise<Message>;
  sendRichMessageDraft(args: SendRichMessageDraftArgsCompat): Promise<true>;
  editMessageText(args: {
    chat_id?: number | string;
    message_id?: number;
    inline_message_id?: string;
    rich_message?: InputRichMessageCompat;
    reply_markup?: unknown;
  }): Promise<Message | true>;
};

function richApi(ctx: Context): RawRichApiCompat {
  // grammY's raw API is a Proxy at runtime, so this cast is useful when your
  // installed type declarations are slightly behind the newest Bot API.
  return ctx.api.raw as unknown as RawRichApiCompat;
}

export async function sendRichMarkdown(
  ctx: Context,
  markdown: string,
  options: {
    chatId?: number | string;
    replyToCurrentMessage?: boolean;
    disableNotification?: boolean;
    protectContent?: boolean;
    skipEntityDetection?: boolean;
    replyMarkup?: InlineKeyboard;
  } = {},
): Promise<Message | undefined> {
  const chatId = options.chatId ?? ctx.chat?.id;
  if (!chatId) return undefined;

  return richApi(ctx).sendRichMessage({
    chat_id: chatId,
    rich_message: {
      markdown,
      skip_entity_detection: options.skipEntityDetection,
    },
    disable_notification: options.disableNotification,
    protect_content: options.protectContent,
    reply_parameters:
      options.replyToCurrentMessage && ctx.msg
        ? { message_id: ctx.msg.message_id }
        : undefined,
    reply_markup: options.replyMarkup,
  });
}

export async function sendRichHtml(
  ctx: Context,
  html: string,
  options: {
    chatId?: number | string;
    disableNotification?: boolean;
    protectContent?: boolean;
    skipEntityDetection?: boolean;
    replyMarkup?: InlineKeyboard;
  } = {},
): Promise<Message | undefined> {
  const chatId = options.chatId ?? ctx.chat?.id;
  if (!chatId) return undefined;

  return richApi(ctx).sendRichMessage({
    chat_id: chatId,
    rich_message: {
      html,
      skip_entity_detection: options.skipEntityDetection,
    },
    disable_notification: options.disableNotification,
    protect_content: options.protectContent,
    reply_markup: options.replyMarkup,
  });
}
```

Use it in your bot:

```ts
import { Bot } from "grammy";
import { sendRichMarkdown } from "./telegram-rich.js";

const bot = new Bot(process.env.BOT_TOKEN!);

bot.command("report", async (ctx) => {
  await sendRichMarkdown(ctx, `# Daily Report

| Metric | Value |
|---|---:|
| New clients | 17 |
| Waiting | 3 |
| Resolved | 14 |

> Generated automatically by the support bot.`);
});

bot.start();
```

---

## 8. Fallback wrapper for production

Create `src/safe-rich.ts`:

```ts
import type { Context } from "grammy";
import { sendRichMarkdown } from "./telegram-rich.js";

function richEnabled(): boolean {
  return process.env.RICH_MESSAGES_ENABLED === "true";
}

function stripMarkdownForFallback(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<details[\s\S]*?<summary>([\s\S]*?)<\/summary>/gi, "\n$1\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export async function replySmart(
  ctx: Context,
  markdown: string,
  options: { preferRich?: boolean } = {},
): Promise<void> {
  const preferRich = options.preferRich ?? true;

  if (preferRich && richEnabled()) {
    try {
      await sendRichMarkdown(ctx, markdown, { replyToCurrentMessage: true });
      return;
    } catch (error) {
      console.error("sendRichMessage failed; falling back to sendMessage", error);
    }
  }

  await ctx.reply(stripMarkdownForFallback(markdown), {
    reply_parameters: ctx.msg ? { message_id: ctx.msg.message_id } : undefined,
  });
}
```

Use it:

```ts
bot.on("message:text", async (ctx) => {
  await replySmart(ctx, `# Answer

You wrote:

> ${ctx.message.text}`);
});
```

---

## 9. Rich Markdown syntax supported by Telegram

Telegram's Rich Markdown mode is broadly compatible with GitHub Flavored Markdown where possible and can contain supported HTML tags.

### 9.1 Inline formatting

```md
**bold text**
__bold text__
*italic text*
_italic text_
~~strikethrough text~~
`inline code`
==marked text==
||spoiler||
[inline URL](https://t.me/)
[inline e-mail](mailto:user@example.com)
[inline phone number](tel:+123456789)
[inline mention](tg://user?id=123456789)
$x^2 + y^2$
```

### 9.2 Blocks

````md
# Heading 1
## Heading 2
### Heading 3

Paragraph text.

```ts
console.log("code block");
```

---

- unordered list item
- another item

1. ordered item
2. second ordered item

- [ ] unchecked task
- [x] checked task

> Block quotation
> continued quotation
````

### 9.3 Tables

```md
| Metric | Value |
|:---|---:|
| Speed | **42 ms** |
| Status | ready |
```

Important: table cells can contain only inline formatting.

### 9.4 Footnotes / references

```md
Text with a reference[^note].

[^note]: Footnote with _italic text_.
```

### 9.5 Mathematical expressions

Inline math:

```md
The formula is $E = mc^2$.
```

Block math:

````md
$$E = mc^2$$

```math
E = mc^2
```
````

Formula source is treated as raw LaTeX.

### 9.6 Collapsible details

```md
<details>
<summary>Open details</summary>

### Inside details

- Item 1
- Item 2

</details>
```

Expanded by default:

```md
<details open>
<summary>Already open</summary>

Visible content.

</details>
```

### 9.7 Media blocks

Media can be specified only as separate blocks. Media URLs must use HTTP or HTTPS.

```md
![](https://example.com/photo.jpg "Photo caption")
![](https://example.com/video.mp4 "Video caption")
![](https://example.com/audio.mp3 "Audio caption")
```

### 9.8 Collage and slideshow

```md
<tg-collage>

![](https://example.com/photo-1.jpg)
![](https://example.com/photo-2.jpg)

</tg-collage>

<tg-slideshow>

![](https://example.com/slide-1.jpg)
![](https://example.com/slide-2.jpg)

</tg-slideshow>
```

### 9.9 Map block

```md
<tg-map lat="41.2995" long="69.2401" zoom="14"/>
```

---

## 10. Rich HTML mode

Use HTML mode when:

- you generate structured HTML directly;
- you want precise control over tags;
- you need tags that Markdown does not express cleanly;
- your app already has safe HTML escaping utilities.

Example:

```ts
await ctx.api.raw.sendRichMessage({
  chat_id: ctx.chat!.id,
  rich_message: {
    html: `<h1>Support Ticket</h1>
<p>Status: <b>Waiting</b></p>
<table bordered striped>
  <tr><th>Field</th><th>Value</th></tr>
  <tr><td>Client</td><td>Ali Valiyev</td></tr>
  <tr><td>Priority</td><td>High</td></tr>
</table>
<details><summary>Operator notes</summary><p>Needs cargo status confirmation.</p></details>`,
  },
});
```

Supported rich HTML includes:

- `<b>`, `<strong>`
- `<i>`, `<em>`
- `<u>`, `<ins>`
- `<s>`, `<strike>`, `<del>`
- `<code>`
- `<mark>`
- `<sub>`, `<sup>`
- `<tg-spoiler>`
- `<a href="...">`
- `<a name="..."></a>`
- `<tg-reference>`
- `<tg-emoji>` / `<img src="tg://emoji?...">`
- `<tg-time>`
- `<tg-math>`
- `<h1>` through `<h6>`
- `<p>`
- `<pre>` / nested `<pre><code class="language-ts">...` for language-tagged code
- `<footer>`
- `<hr/>`
- `<ul>`, `<ol>`, `<li>`
- checkbox inputs in lists
- `<blockquote>`
- `<aside>`
- media tags: `<img>`, `<video>`, `<audio>`
- `<figure>`, `<figcaption>`, `<cite>`
- `<tg-map>`
- `<tg-collage>`
- `<tg-slideshow>`
- `<table>`, `<tr>`, `<th>`, `<td>`, `<caption>`
- `<details>`, `<summary>`
- `<tg-math-block>`
- `<tg-thinking>` only in rich message drafts

---

## 11. Escaping untrusted HTML

If any part of the HTML comes from a user, database, CRM field, or AI output, escape it before interpolation.

```ts
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
```

Usage:

```ts
const clientName = escapeHtml(client.fullName);

await ctx.api.raw.sendRichMessage({
  chat_id: ctx.chat!.id,
  rich_message: {
    html: `<h1>Client</h1><p>${clientName}</p>`,
  },
});
```

Do not blindly send raw model-generated HTML unless your model output is validated or sanitized.

---

## 12. Streaming AI output with `sendRichMessageDraft`

`sendRichMessageDraft` streams a temporary rich message preview while the real answer is being generated.

Important rules:

- It is for **private chats**.
- `chat_id` is an integer private chat ID.
- `draft_id` must be non-zero.
- Updates with the same `draft_id` are animated.
- The draft is ephemeral and acts as a temporary preview.
- After generation finishes, you must call `sendRichMessage` with the complete message to persist it in chat.
- A `RichBlockThinking` / `<tg-thinking>` block may be used only in drafts.

### 12.1 Draft streaming helper

Create `src/rich-stream.ts`:

```ts
import type { Context } from "grammy";
import type { Message } from "grammy/types";
import type {
  InputRichMessageCompat,
  SendRichMessageDraftArgsCompat,
  SendRichMessageArgsCompat,
} from "./telegram-rich.js";

type RawRichApiCompat = {
  sendRichMessageDraft(args: SendRichMessageDraftArgsCompat): Promise<true>;
  sendRichMessage(args: SendRichMessageArgsCompat): Promise<Message>;
};

function rawRich(ctx: Context): RawRichApiCompat {
  return ctx.api.raw as unknown as RawRichApiCompat;
}

function createDraftId(): number {
  const id = Date.now() % 2_147_483_647;
  return id === 0 ? 1 : id;
}

export async function streamRichAiAnswer(
  ctx: Context,
  chunks: AsyncIterable<string>,
): Promise<void> {
  if (!ctx.chat) return;

  // sendRichMessageDraft is intended for private chats only.
  if (ctx.chat.type !== "private") {
    let finalText = "";
    for await (const chunk of chunks) finalText += chunk;

    await rawRich(ctx).sendRichMessage({
      chat_id: ctx.chat.id,
      rich_message: { markdown: finalText },
    });
    return;
  }

  const draftId = createDraftId();
  let finalMarkdown = "";

  await rawRich(ctx).sendRichMessageDraft({
    chat_id: ctx.chat.id,
    draft_id: draftId,
    rich_message: {
      html: `<tg-thinking>Thinking…</tg-thinking>`,
    },
  });

  let lastUpdate = 0;

  for await (const chunk of chunks) {
    finalMarkdown += chunk;

    // Throttle draft updates. Updating on every token is wasteful.
    const now = Date.now();
    if (now - lastUpdate < 700) continue;
    lastUpdate = now;

    await rawRich(ctx).sendRichMessageDraft({
      chat_id: ctx.chat.id,
      draft_id: draftId,
      rich_message: {
        markdown: finalMarkdown,
      },
    });
  }

  await rawRich(ctx).sendRichMessage({
    chat_id: ctx.chat.id,
    rich_message: {
      markdown: finalMarkdown || "No answer generated.",
    },
  });
}
```

Example fake stream:

```ts
async function* fakeAiStream(): AsyncIterable<string> {
  yield "# AI Answer\n\n";
  await new Promise((r) => setTimeout(r, 500));
  yield "This is a streamed ";
  await new Promise((r) => setTimeout(r, 500));
  yield "rich message answer.\n\n";
  await new Promise((r) => setTimeout(r, 500));
  yield "| Part | Status |\n|---|---|\n| Draft | done |";
}

bot.command("stream", async (ctx) => {
  await streamRichAiAnswer(ctx, fakeAiStream());
});
```

---

## 13. Editing a rich message

Telegram added a `rich_message` parameter to `editMessageText`.

Example:

```ts
const sent = await ctx.api.raw.sendRichMessage({
  chat_id: ctx.chat!.id,
  rich_message: {
    markdown: "# Status\n\nProcessing…",
  },
});

await ctx.api.raw.editMessageText({
  chat_id: ctx.chat!.id,
  message_id: sent.message_id,
  rich_message: {
    markdown: "# Status\n\n✅ Done",
  },
});
```

Notes:

- Use `rich_message` instead of `text` when editing rich content.
- If `text` is not provided, `rich_message` is required.
- Telegram editing limitations still apply. In particular, Bot API docs note that editing is currently possible only for messages without `reply_markup` or with inline keyboards.

---

## 14. Inline query result with rich message content

Rich Messages can be used as inline result content through `InputRichMessageContent`.

Example:

```ts
bot.on("inline_query", async (ctx) => {
  await ctx.answerInlineQuery(
    [
      {
        type: "article",
        id: "rich-help",
        title: "Rich help message",
        input_message_content: {
          rich_message: {
            markdown: `# Help

| Command | Description |
|---|---|
| /start | Start the bot |
| /report | Generate report |`,
          },
        },
      } as const,
    ],
    { cache_time: 0 },
  );
});
```

If your installed types do not yet recognize `rich_message` inside `input_message_content`, temporarily cast that object:

```ts
input_message_content: {
  rich_message: { markdown: "# Help" },
} as unknown as { message_text: string }
```

Prefer updating `grammy` / `@grammyjs/types` instead of keeping casts forever.

---

## 15. Message limits

Telegram's Rich Message limits:

| Limit | Value |
|---|---:|
| Rich message text | Up to 32,768 UTF-8 characters |
| Blocks | Up to 500 blocks, including nested blocks, list items, ordered list items, table rows, quotation blocks, and details blocks |
| Nesting | Up to 16 levels |
| Media attachments | Up to 50 total photos, videos, and audio files |
| Table columns | Up to 20 columns |

Engineering recommendation:

- Keep AI replies below 12,000–16,000 characters where possible.
- Split very long generated reports into multiple messages.
- Keep tables narrow for mobile screens.
- Avoid deeply nested details blocks.
- Avoid large media-heavy rich messages unless you have tested them on mobile and desktop clients.

---

## 16. Choosing Markdown vs HTML

| Use case | Prefer |
|---|---|
| LLM answer text | `markdown` |
| Reports with headings, lists, tables | `markdown` |
| Content generated by templates | `html` |
| Precise layout with custom tags | `html` |
| User-generated text | Either, but escape/sanitize carefully |
| Complex mixed media | `html` or Markdown with embedded supported HTML |

Recommended default for AI bots: **generate Markdown**, then optionally post-process it.

---

## 17. AI output pipeline

A safe production pipeline should look like this:

```text
User message
  ↓
Prompt builder
  ↓
LLM response in controlled Markdown
  ↓
Validation / cleanup
  ↓
Rich Markdown send attempt
  ↓
Fallback to classic message if needed
```

### 17.1 Prompt your model for Telegram Rich Markdown

Example system instruction:

```text
You are writing for Telegram Rich Messages.
Use concise Markdown.
Use headings, bullet lists, and small tables where useful.
Do not use raw HTML except <details>, <summary>, <tg-math-block>, <tg-map>, <tg-collage>, or <tg-slideshow> when explicitly needed.
Do not include unsafe links.
Keep tables mobile-friendly with no more than 4 columns.
```

### 17.2 Clean accidental unsupported output

```ts
export function normalizeRichMarkdown(markdown: string): string {
  return markdown
    // Avoid huge accidental heading chains.
    .replace(/^#{7,}/gm, "######")
    // Remove script/style if a model accidentally emits it.
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .trim();
}
```

---

## 18. Support-bot example: CRM client summary

```ts
import { Bot, InlineKeyboard } from "grammy";
import { sendRichMarkdown } from "./telegram-rich.js";

const bot = new Bot(process.env.BOT_TOKEN!);

bot.command("client", async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text("Assign operator", "assign_operator")
    .text("Close", "close_ticket");

  await sendRichMarkdown(
    ctx,
    `# Client Summary

| Field | Value |
|---|---|
| Client | Ali Valiyev |
| Phone | +998 90 123 45 67 |
| Status | Waiting for operator |
| Priority | High |

## Request

> Client asks where the cargo is and when it will arrive.

## Suggested operator reply

Assalomu alaykum, Ali aka. Yookingiz holatini tekshirib, sizga tez orada aniq ma'lumot beramiz.

<details>
<summary>Internal notes</summary>

- Check cargo status in CRM.
- Confirm route and estimated arrival.
- Avoid promising exact time before operator confirmation.

</details>`,
    { replyMarkup: keyboard },
  );
});

bot.callbackQuery("assign_operator", async (ctx) => {
  await ctx.answerCallbackQuery("Assigned.");
});

bot.callbackQuery("close_ticket", async (ctx) => {
  await ctx.answerCallbackQuery("Closed.");
});

bot.start();
```

---

## 19. Cargo / logistics table example

```ts
await sendRichMarkdown(ctx, `# Cargo Quote

| Parameter | Value |
|---|---:|
| Weight | 240 kg |
| Route | Guangzhou → Tashkent |
| Cargo type | General cargo |
| Estimated price | $480 |

## Missing data

- TN VED code
- Exact pickup address
- Company name

<details open>
<summary>Next questions for client</summary>

1. Yuk qaysi shahardan olinadi?
2. Yukning aniq manzili bormi?
3. TN VED kodi bormi?

</details>`);
```

---

## 20. Error handling

Common issues and fixes:

| Symptom | Likely cause | Fix |
|---|---|---|
| `Bad Request: can't parse rich message` | Invalid rich Markdown/HTML | Simplify the payload, validate tags, test minimal version first. |
| TypeScript says `sendRichMessage` does not exist | Local type declarations are old | Update `grammy` / `@grammyjs/types`; temporarily use a compatibility cast. |
| Draft does not appear | Tried draft in non-private chat or invalid `draft_id` | Use `sendRichMessageDraft` only in private chats; make `draft_id` non-zero. |
| Draft appears but final answer disappears | You did not call `sendRichMessage` after draft streaming | Always send the final persistent message. |
| Media block fails | URL is not HTTP/HTTPS or bot lacks permission | Use public HTTPS URLs and ensure bot can send that media type. |
| Table looks bad on mobile | Too many columns or long cell values | Keep tables narrow; prefer key-value tables. |
| Links are detected unexpectedly | Automatic entity detection | Use `skip_entity_detection: true` if appropriate. |
| User sees unsupported rich content | Client rollout/rendering issue | Feature-flag rich messages and fall back to classic `sendMessage`. |

---

## 21. Direct Bot API test with cURL

Before debugging grammY, verify the Bot API method directly:

```bash
curl -X POST "https://api.telegram.org/bot$BOT_TOKEN/sendRichMessage" \
  -H "Content-Type: application/json" \
  -d '{
    "chat_id": 123456789,
    "rich_message": {
      "markdown": "# Test\\n\\n| A | B |\\n|---|---|\\n| 1 | 2 |"
    }
  }'
```

Draft test:

```bash
curl -X POST "https://api.telegram.org/bot$BOT_TOKEN/sendRichMessageDraft" \
  -H "Content-Type: application/json" \
  -d '{
    "chat_id": 123456789,
    "draft_id": 1001,
    "rich_message": {
      "html": "<tg-thinking>Thinking…</tg-thinking>"
    }
  }'
```

Then persist the final message:

```bash
curl -X POST "https://api.telegram.org/bot$BOT_TOKEN/sendRichMessage" \
  -H "Content-Type: application/json" \
  -d '{
    "chat_id": 123456789,
    "rich_message": {
      "markdown": "# Final Answer\\n\\nDone."
    }
  }'
```

---

## 22. Recommended project structure

```text
src/
  bot.ts
  telegram-rich.ts       # low-level raw API wrappers
  rich-stream.ts         # draft streaming helper
  safe-rich.ts           # feature flag + fallback
  markdown-cleanup.ts    # optional LLM output cleanup
  ai/
    generate-answer.ts
```

---

## 23. Deployment notes

### 23.1 Long polling

```ts
bot.start();
```

Good for local development and simple servers.

### 23.2 Webhooks

Rich Messages work through normal Bot API calls, so webhook vs polling does not change the sending code.

Use webhooks in production when:

- you deploy on serverless / edge environments;
- you need faster update delivery;
- you run multiple instances and need cleaner scaling.

### 23.3 Self-hosted Bot API server

If you use a self-hosted Telegram Bot API server, make sure that server version supports Bot API 10.1 or newer. If it does not, `sendRichMessage` and `sendRichMessageDraft` may fail even if your grammY code is correct.

---

## 24. Production checklist

Before enabling this in production:

- [ ] `grammy` and `@grammyjs/types` are updated.
- [ ] `sendRichMessage` tested with cURL.
- [ ] `sendRichMessage` tested from grammY with `ctx.api.raw`.
- [ ] Feature flag exists: `RICH_MESSAGES_ENABLED`.
- [ ] Fallback to classic `ctx.reply()` exists.
- [ ] AI output is normalized/validated.
- [ ] HTML interpolation escapes user/CRM data.
- [ ] Tables are mobile-friendly.
- [ ] Draft streaming is private-chat-only.
- [ ] Draft streaming throttles updates.
- [ ] Final persistent message is sent after drafts.
- [ ] Logs capture Telegram `Bad Request` descriptions.
- [ ] Bot permissions are checked for media-rich messages.
- [ ] Client compatibility is tested on Telegram Android, iOS, Desktop, and Web.

---

## 25. Final recommended abstraction

For most bots, expose only one high-level function to the rest of your codebase:

```ts
await replySmart(ctx, richMarkdown);
```

Internally, that function should:

1. check your feature flag;
2. try `sendRichMessage`;
3. catch and log errors;
4. degrade to classic `sendMessage`.

That gives you the new rich AI-bot experience without risking broken conversations when a client, Bot API server, or formatting payload fails.

---

## 26. Source notes

This guide is based on the official Telegram Bot API and grammY documentation current on 2026-06-15.

Key official facts used:

- `InputRichMessage` accepts exactly one of `html` or `markdown`.
- `sendRichMessage` sends persistent rich messages.
- `sendRichMessageDraft` streams temporary 30-second previews and requires a final `sendRichMessage` call to persist the output.
- `editMessageText` accepts `rich_message`.
- Rich Markdown supports headings, lists, tables, media blocks, quotes, footnotes, details, formulas, and supported HTML.
- Rich Messages have limits: 32,768 UTF-8 characters, 500 blocks, 16 nesting levels, 50 media attachments, and 20 table columns.
- grammY exposes a raw Bot API interface through `api.raw` with payloads shaped like the official Bot API methods.
