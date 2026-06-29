# Template Message Creation Flow

This document describes the current template-message creation and management flow in the Probox Telegram bot. It is based on the active implementation in `src/bot.ts`, `src/handlers/admin.handler.ts`, `src/conversations/admin-template.conversation.ts`, `src/keyboards/template.keyboards.ts`, `src/services/message-template.service.ts`, `src/services/bot-notification.service.ts`, and the Uzbek/Russian locale files.

## Purpose

Template messages are reusable Telegram messages created by admins and later selected by business event type. They let the bot send localized campaign, coupon, payment, referral, and winner notifications without hardcoding the final message text in each sending flow.

Each template stores:

| Field | Meaning |
| --- | --- |
| `template_key` | Admin-defined unique key, intended to identify the concrete version of the template. |
| `template_type` | Event type used by the sending code to select the active template. |
| `title` | Human-readable admin title shown in the template list and detail card. |
| `content_uz` | Uzbek message body. |
| `content_ru` | Russian message body. |
| `channel` | Delivery channel. Created templates use `telegram_bot`. |
| `is_active` | Whether the template can be selected for sending. |

## Admin Entry Point

Admins reach template management from the admin menu button localized by `admin_campaign_templates`.

| Locale | Admin menu label |
| --- | --- |
| Uzbek | `📨 Xabar shablonlari` |
| Russian | `📨 Шаблоны сообщений` |

The admin menu is built by `getAdminMenuKeyboard(locale)` and routes the menu action through:

- `bot.filter(hears('admin_campaign_templates'), adminCampaignTemplatesHandler)`
- `adminCampaignTemplatesHandler(ctx)`
- `showAdminTemplatesList(ctx, locale)`

Every admin template handler first calls `requireAdmin(ctx)`. Non-admin users cannot open, create, edit, toggle, or delete message templates through this flow.

## Registered Conversations and Callbacks

The bot registers two conversations for this feature:

| Conversation | Purpose |
| --- | --- |
| `adminTemplateCreateConversation` | Five-step wizard for creating a new template. |
| `adminTemplateEditConversation` | Field-specific wizard for editing one existing template field. |

The inline keyboards use these callback constants:

| Callback | Pattern | Handler | Purpose |
| --- | --- | --- | --- |
| `admin_template_create` | exact | `adminTemplateCreateHandler` | Start the creation wizard. |
| `atpd:` | `^atpd:\d+$` | `adminTemplateDetailHandler` | Open a template detail card. |
| `ate:` | `^ate:\d+:[a-z_]+$` | `adminTemplateEditHandler` | Edit one field on a template. |
| `att:` | `^att:\d+$` | `adminTemplateToggleHandler` | Toggle active/inactive state. |
| `atdl:` | `^atdl:\d+$` | `adminTemplateDeleteHandler` | Delete a template. |
| `admin_templates_back` | exact | `adminTemplateBackToListHandler` | Return from detail card to list. |
| `atpg:` | `^atpg:\d+$` | `adminTemplatePageHandler` | Refreshes the list; pagination is prepared but not implemented beyond a single page. |

When a create or edit action starts, the handler exits any active conversation with `ctx.conversation.exitAll()` before entering the template conversation. This prevents mixed admin workflows from sharing stale conversation state.

## Template List Screen

`showAdminTemplatesList(ctx, locale)` loads templates with `MessageTemplateService.listTemplates()`.

The service orders templates by:

1. `template_type` ascending
2. `id` ascending

`getAdminTemplatesKeyboard(templates, page, totalPages, locale)` then creates one inline row per template:

- `🟢 {template.title}` for active templates
- `⚫ {template.title}` for inactive templates

The list keyboard always adds:

| Button | Locale key | Callback |
| --- | --- | --- |
| Create template | `admin_campaign_template_create` | `admin_template_create` |
| Back to menu | `admin_back_to_menu` | `admin_back_to_menu` |

Current note: `admin_campaign_templates_empty` exists in both locales, but the current list builder does not display it when there are no templates. An empty list still shows the screen title and the create/back buttons.

## Creation Wizard

Creation starts in `adminTemplateCreateHandler(ctx)`:

1. Admin permission is checked.
2. The callback message is cleaned up if creation started from an inline button.
3. All active conversations are exited.
4. `adminTemplateCreateConversation` starts.

The conversation resolves the admin locale from `session.__language_code`; if it is missing, the default locale is Uzbek (`uz`).

Creation then follows this exact order:

| Step | Method | Locale key | Expected admin input |
| --- | --- | --- | --- |
| Intro guidance | `ctx.reply(...)` | `admin_campaign_template_create_guidance` | No input. Shows instructions, placeholders, example, and cancellation note. |
| Title | `waitForText(...)` | `admin_campaign_ask_template_title` | Free text. Stored as `title`. |
| Unique key | `waitForText(...)` | `admin_campaign_ask_template_key` | Free text. Stored as `template_key`. Must be unique in the database. |
| Type | `waitForTypeSelection(...)` | `admin_campaign_ask_template_type` | Inline button. Stored as `template_type`. |
| Uzbek body | `waitForText(...)` | `admin_campaign_ask_template_content_uz` | Free text. Stored as `content_uz`. |
| Russian body | `waitForText(...)` | `admin_campaign_ask_template_content_ru` | Free text. Stored as `content_ru`. |

After all required values are collected, the conversation calls:

```ts
MessageTemplateService.create({
  title,
  template_key: key,
  template_type: type,
  content_uz: contentUz,
  content_ru: contentRu,
  channel: 'telegram_bot',
  is_active: true
})
```

The created template is active immediately. After successful creation, the bot sends `admin_template_created`, restores the admin menu keyboard, and shows the newly created template detail card.

If database insertion fails, for example because `template_key` is not unique, the conversation logs `Error creating template:` and sends `admin_error` with the admin menu keyboard.

## Supported Template Types

Creation and edit type selection are limited to this inline-button list:

| Type | Main usage in code |
| --- | --- |
| `store_visit` | Coupon registration for store visits and pending store-visit coupon claims. |
| `purchase` | Coupon registration for purchases and pending purchase coupon claims. |
| `referral` | Referral reward notifications. |
| `payment_reminder_d2` | Payment reminder two days before due date. |
| `payment_reminder_d1` | Payment reminder one day before due date. |
| `payment_reminder_d0` | Payment reminder on due date. |
| `payment_paid_on_time` | On-time payment reward notifications and recovery notifications. |
| `payment_overdue` | Overdue payment reminders. |
| `payment_paid_late` | Late-payment status notifications. |
| `winner_notification` | Campaign winner notification after an admin marks a coupon as winner. |

The inline type selector displays the raw type names two per row. It also includes a localized cancel button.

## Cancellation Behavior

Text-input steps use `waitForText(...)`. The bot sends each prompt with a one-time reply keyboard containing the localized `admin_cancel` button.

Type-selection steps use `waitForTypeSelection(...)`. The bot sends inline buttons for all supported template types and an inline localized cancel button.

Cancellation succeeds when the user sends or clicks the exact localized cancel value:

| Locale | `admin_cancel` button | Cancellation reply |
| --- | --- | --- |
| Uzbek | `❌ Bekor qilish` | `❌ Bekor qilindi.` |
| Russian | `❌ Отмена` | `❌ Отменено.` |

On cancellation, the bot returns the admin menu keyboard and stops the current create/edit conversation. The guidance text says to press "Bekor qilish" or "Отмена"; the actual button label includes the leading `❌` icon because cancellation is matched against the localized button value.

## Localized Creation Guidance

The introductory guidance is sent before the first input step with `parse_mode: 'HTML'`.

### Uzbek Guidance

Locale key: `admin_campaign_template_create_guidance`

```text
📝 Yangi xabar shabloni yaratish bo'yicha yo'riqnoma

1. <b>Sarlavha</b>: admin ichida ko'rinadigan nom. Masalan: Visited Store
2. <b>Kalit</b>: noyob bo'lishi kerak. Faqat lotincha yozing. Masalan: visited_store_v1
3. <b>Tur</b>: xabar qaysi hodisa uchun ishlashini belgilaydi. Do'konga tashrif uchun `store_visit` ni tanlang.
4. <b>Matn</b>: o'zgaruvchilarni <code>{"{{customer_name}}"}</code> kabi formatda yozing.

Hozir amalda ishlaydigan placeholder'lar:
- <code>{"{{customer_name}}"}</code> -- Mijozning ismi va familiyasi
- <code>{"{{coupon_code}}"}</code> -- PRO bilan boshlanadigan 10 belgili kupon kodi (avtomatik ravishda inline-code formatiga o'tkaziladi)
- <code>{"{{payment_due_date}}"}</code> -- Navbatdagi to'lov muddati (sana)
- <code>{"{{product_name}}"}</code> -- Mahsulot nomi
- <code>{"{{referrer_name}}"}</code> -- Taklif qilgan kishi ismi
- <code>{"{{prize_name}}"}</code> -- Yutuq nomi

Do'konga tashrif uchun tavsiya etilgan misol:
<blockquote>Assalomu alaykum, <code>{"{{customer_name}}"}</code>! Probox do'konimizga tashrif buyurganingiz uchun rahmat. Siz uchun {"{{coupon_code}}"} maxsus promo-kodi yaratildi.</blockquote>

Bekor qilish uchun istalgan bosqichda "Bekor qilish" tugmasini bosing.
```

### Russian Guidance

Locale key: `admin_campaign_template_create_guidance`

```text
📝 Инструкция по созданию нового шаблона сообщения

1. <b>Название</b>: это имя шаблона внутри админки. Пример: Visited Store
2. <b>Ключ</b>: должен быть уникальным. Используйте латиницу. Пример: visited_store_v1
3. <b>Тип</b>: определяет, для какого события будет использоваться шаблон. Для визита в магазин выберите `store_visit`.
4. <b>Текст</b>: переменные пишутся в формате <code>{"{{customer_name}}"}</code>.

Поддерживаемые placeholder'ы:
- <code>{"{{customer_name}}"}</code> -- Имя и фамилия клиента
- <code>{"{{coupon_code}}"}</code> -- 10-символьный код купона (автоматически форматируется как inline-code)
- <code>{"{{payment_due_date}}"}</code> -- Срок следующего платежа
- <code>{"{{product_name}}"}</code> -- Название товара
- <code>{"{{referrer_name}}"}</code> -- Имя пригласившего (реферера)
- <code>{"{{prize_name}}"}</code> -- Название приза

Рекомендуемый пример для визита в магазин:
<blockquote>Здравствуйте, <code>{"{{customer_name}}"}</code>! Спасибо, что посетили магазин Probox. Для вас создан специальный промо-код {"{{coupon_code}}"}.</blockquote>

Чтобы отменить создание, на любом шаге нажмите кнопку "Отмена".
```

## Localized Prompt and Result Text

| Purpose | Locale key | Uzbek | Russian |
| --- | --- | --- | --- |
| Create button | `admin_campaign_template_create` | `➕ Shabloni qo'shish` | Not defined in the current `ru.ftl`; Russian rendering depends on the i18n library's missing-message behavior. |
| Ask title | `admin_campaign_ask_template_title` | `Shablon sarlavhasini kiriting:` | `Введите название шаблона:` |
| Ask key | `admin_campaign_ask_template_key` | `Shablon kalitini kiriting (masalan: order_success):` | `Введите уникальный ключ шаблона (например, payment_reminder):` |
| Ask type | `admin_campaign_ask_template_type` | `Shablon turini tanlang:` | `Выберите тип шаблона (событие):` |
| Ask Uzbek content | `admin_campaign_ask_template_content_uz` | `O'zbekcha matnni kiriting ( <code>{"{{var}}"}</code> formatidagi o'zgaruvchilardan foydalanishingiz mumkin):` | `Введите текст сообщения на узбекском (используйте <code>{"{{placeholder_name}}"}</code> для переменных):` |
| Ask Russian content | `admin_campaign_ask_template_content_ru` | `Ruscha matnni kiriting ( <code>{"{{var}}"}</code> formatidagi o'zgaruvchilardan foydalanishingiz mumkin):` | `Введите текст сообщения на русском (используйте <code>{"{{placeholder_name}}"}</code> для переменных):` |
| Created | `admin_template_created` | `✅ Shablon yaratildi.` | `✅ Шаблон успешно создан.` |
| Updated | `admin_template_updated` | `✅ Shablon yangilandi.` | `✅ Шаблон обновлен.` |
| Deleted | `admin_template_deleted` | `✅ Shablon o'chirildi.` | `✅ Шаблон удален.` |
| Status updated | `admin_template_status_updated` | `✅ Shablon holati yangilandi.` | `✅ Статус шаблона изменен.` |
| Generic error | `admin_error` | `❌ Xatolik yuz berdi.` | `❌ Произошла ошибка.` |
| Winner template missing | `admin_campaign_winner_template_missing` | `⚠️ G'oliblar uchun xabar shabloni (winner_notification) topilmadi. Uni yaratmasangiz foydalanuvchiga xabar yuborib bo'lmaydi.` | `⚠️ Шаблон сообщения для победителей (winner_notification) не найден. Без него невозможно отправить уведомление пользователю.` |

## Detail Card and Edit Flow

After creation, list selection, status toggle, or field edit, the bot shows a template detail card built by `buildAdminTemplateSummary(template, locale)`.

The card includes:

- localized detail header
- template title
- `template_key`
- `template_type`
- localized active/inactive status
- full Uzbek content
- full Russian content

The detail keyboard lets admins edit:

| Field | Callback payload | Edit prompt key |
| --- | --- | --- |
| Key | `ate:{templateId}:template_key` | `admin_campaign_edit_prompt_template_key` |
| Type | `ate:{templateId}:template_type` | `admin_campaign_ask_template_type` |
| Title | `ate:{templateId}:title` | `admin_campaign_edit_prompt_template_title` |
| Uzbek content | `ate:{templateId}:content_uz` | `admin_campaign_edit_prompt_template_content_uz` |
| Russian content | `ate:{templateId}:content_ru` | `admin_campaign_edit_prompt_template_content_ru` |

`adminTemplateEditHandler(ctx)` stores the selected target in session:

```ts
ctx.session.adminTemplateEditTarget = {
  templateId,
  field,
}
```

`adminTemplateEditConversation` reads that session target, asks only the relevant prompt, updates the selected field with `MessageTemplateService.update(id, data)`, sends `admin_template_updated`, shows the updated detail card, and clears `adminTemplateEditTarget` in `finally`.

## Active State and Deletion

`adminTemplateToggleHandler(ctx)` loads the selected template and flips `is_active` by calling:

```ts
MessageTemplateService.setTemplateActiveState(templateId, !template.is_active)
```

The detail keyboard label uses:

| Current state | Button locale key |
| --- | --- |
| Active | `admin_campaign_make_inactive` |
| Inactive | `admin_campaign_make_active` |

`adminTemplateDeleteHandler(ctx)` deletes immediately with `MessageTemplateService.delete(templateId)`, sends either `admin_template_deleted` or `admin_error`, and then returns to the template list. Although `admin_campaign_delete_confirm` exists in the Uzbek locale, the current delete handler does not perform a confirmation step.

## Database Schema

`20260328113100_repair_message_templates_schema.ts` creates or repairs the `message_templates` table.

Important schema rules:

- `id` is a `bigIncrements` primary key.
- `template_key` is required, max length 120, and globally unique.
- `template_type` is a PostgreSQL enum named `message_template_type`.
- `title` is required, max length 255.
- `content_uz` and `content_ru` are required text fields.
- `channel` defaults to `telegram_bot`.
- `is_active` defaults to `true`.
- `created_at` and `updated_at` default to current time.
- Indexes exist for `template_key`, `template_type`, and `is_active`.

The enum values match the supported type list in the creation conversation.

## Service Methods

`MessageTemplateService` is the persistence and rendering API for templates.

| Method | Role |
| --- | --- |
| `getContent(template, locale)` | Returns `content_ru` only when locale is exactly `ru`; otherwise returns `content_uz`. |
| `hasPlaceholder(template, locale, placeholder)` | Checks whether the localized content contains `{{placeholder}}` with optional whitespace. |
| `getActiveTemplateByType(type)` | Finds the latest active `telegram_bot` template for a type, ordered by `updated_at desc`. |
| `getById(id)` | Loads a template by primary key. |
| `listTemplates()` | Lists all templates for admin display. |
| `create(data)` | Inserts a new template and timestamps it. |
| `update(id, data)` | Updates selected fields and refreshes `updated_at`. |
| `setTemplateActiveState(id, isActive)` | Updates `is_active`. |
| `delete(id)` | Deletes the template row. |
| `render(template, locale, placeholders)` | Replaces `{{placeholder}}` tokens in the selected localized body. |

## Placeholder Rendering Rules

`MessageTemplateService.render(...)` replaces placeholders matching:

```text
{{ placeholder_name }}
```

Allowed placeholder names are alphanumeric plus underscore because the renderer uses:

```regex
\{\{\s*([a-zA-Z0-9_]+)\s*\}\}
```

Rendering behavior:

- Missing, `null`, `undefined`, or empty-string values render as an empty string.
- `coupon_code` is automatically wrapped in `<code>...</code>`.
- If `coupon_code` is already surrounded by `<code>` and `</code>` in the raw template, the renderer does not double-wrap it.
- Other placeholders are inserted as plain string values.
- Rendered messages are sent with Telegram `parse_mode: 'HTML'`.

Operational note: because placeholder values are not globally HTML-escaped by the renderer, template text and placeholder sources must remain controlled and HTML-safe.

## Business Placeholder Sources

The user-facing guidance lists these placeholders, and the current sending code supplies them consistently across notification flows:

| Placeholder | Typical source |
| --- | --- |
| `customer_name` | Coupon event customer name, linked SAP/customer user full name, or fallback display name. |
| `coupon_code` | Coupon code assigned to the user or referrer. |
| `payment_due_date` | Formatted installment due date or coupon expiry date, depending on flow. |
| `product_name` | Product name from coupon registration payload or formatted SAP item list. |
| `referrer_name` | Referrer full-name snapshot or referrer display name for referral rewards. |
| `prize_name` | Prize title for winner notifications. |

Additional placeholder names technically render if callers provide them, but the bot guidance and current production senders are built around the six placeholders above.

## Delivery Flow

Templates are sent through `BotNotificationService.sendTemplateMessage(...)`.

The delivery flow is:

1. Load the active template by `templateType` with `MessageTemplateService.getActiveTemplateByType(type)`.
2. If no active template exists, write a dispatch log with status `template_not_found` and return a failed result.
3. Select template content based on `user.language_code`; Russian users receive `content_ru`, all other users receive `content_uz`.
4. Render placeholders.
5. Send the result through Telegram with `parse_mode: 'HTML'`.
6. If delivery succeeds, unblock the user in local state if they had been marked blocked.
7. Write a `message_dispatch_logs` row with status `sent`.
8. If Telegram reports that the user blocked the bot, mark the user as blocked locally.
9. Write a failed dispatch log with the error message.

The dispatch log table stores:

| Field | Meaning |
| --- | --- |
| `user_id` | Receiving user, nullable. |
| `coupon_id` | Related coupon, nullable. |
| `template_id` | Template used, nullable when not found. |
| `dispatch_type` | Business dispatch category. |
| `status` | `sent`, `failed`, or `template_not_found`. |
| `error_message` | Error text when delivery fails. |
| `created_at` | Log timestamp. |

## Photo Behavior for Winner Notifications

Winner notifications can attach a prize photo. `BotNotificationService.sendRenderedMessage(...)` attaches the photo only when:

1. A photo is provided.
2. The selected localized template contains the `prize_name` placeholder.

If the rendered text is 1024 characters or less, the bot sends the photo with the rendered text as the caption. If it is longer than 1024 characters, the bot sends the photo first and then sends the rendered text as a separate message.

## Missing Template Recovery

Two flows explicitly guide admins back to template creation when required templates are missing.

### Winner Notification

Before marking a coupon as a winner, `adminCouponMarkWinnerHandler(ctx)` checks for an active `winner_notification` template.

If it is missing, the bot sends `admin_campaign_winner_template_missing` and attaches `getAdminMissingTemplateKeyboard(locale)`, which contains:

- create template button: `admin_campaign_template_create` -> `admin_template_create`
- back to menu button: `admin_back_to_menu` -> `admin_back_to_menu`

This means admins can immediately open the same creation wizard from the warning message.

### Payment Reminder Cron

`PaymentReminderService` collects missing template types during payment reminder processing. When missing templates are detected, it notifies admins with a message that includes the missing type list and attaches `getAdminMissingTemplateKeyboard(locale)`. This is not fully localized through FTL in the current code; the warning text is hardcoded in Russian, while the keyboard buttons use each admin's locale.

## Current Accuracy Notes and Gaps

- Template creation is admin-only and conversation-based.
- Creation requires both Uzbek and Russian content; there is no single-locale template.
- Created templates are immediately active.
- Active template lookup is by `template_type`, `channel = 'telegram_bot'`, and `is_active = true`; when multiple active templates share a type, the latest `updated_at` wins.
- `template_key` must be unique, but `template_type` does not have a uniqueness constraint.
- Uzbek defines the create-template button key `admin_campaign_template_create`; Russian currently does not define that exact key, even though the shared keyboard calls it.
- Russian defines additional template-specific button keys such as `admin_campaign_edit_template_key_btn`, `admin_campaign_template_delete`, and `admin_campaign_template_toggle_active`, but the current keyboard uses the shared keys `admin_campaign_edit_template_key`, `admin_campaign_delete`, `admin_campaign_make_inactive`, and `admin_campaign_make_active`.
- The delete button deletes immediately; the currently defined `admin_campaign_delete_confirm` locale key is not used by the template delete handler.
- The template list has pagination callback constants, but the current list always uses page `1` and total pages `1`.
- The empty-list locale key exists but is not rendered by the current list implementation.
- Locale selection for sent messages is strict: only `ru` uses Russian content; every other value uses Uzbek content.
- The create guidance examples use `<blockquote>` and `<code>` tags and are sent with Telegram HTML parsing.

## Recommended Admin Authoring Checklist

Before activating or relying on a template, confirm:

1. `template_key` is unique and descriptive, for example `store_visit_v1` or `payment_reminder_d1_v2`.
2. `template_type` matches the business event that will send the message.
3. Both `content_uz` and `content_ru` are complete.
4. Placeholders use double braces, for example `{{customer_name}}`.
5. `coupon_code` is not manually over-formatted unless it is intentionally wrapped with `<code>...</code>`.
6. HTML tags are valid for Telegram HTML parse mode.
7. Winner templates include `{{prize_name}}` if the prize photo should be attached.
8. The template is active before the business event or cron job runs.
