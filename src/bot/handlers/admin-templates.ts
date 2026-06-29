import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import type { BotDependencies } from '../create-bot.js';
import type { Locale } from '../../types/client.js';
import { t } from '../messages.js';
import { escapeHtml } from '../../utils/html.js';
import { clearAdminExportFlow, clearAdminTemplateFlow, clearSupportFlow } from '../session.js';
import {
  personalMenuKeyboard,
  adminTemplateCancelKeyboard,
  adminTemplateDetailKeyboard,
  adminTemplateListKeyboard,
  adminTemplateTypeKeyboard,
} from '../keyboards.js';
import { requireAdmin } from './admin-clients.js';
import type {
  MessageTemplate,
  MessageTemplateDraft,
  MessageTemplateField,
  MessageTemplateType,
} from '../../types/message-template.js';
import { isMessageTemplateType } from '../../types/message-template.js';
import type { MessageTemplateStore } from '../../services/message-template.service.js';
import type { Logger } from '../../utils/logger.js';

type TemplateWindowOptions = NonNullable<Parameters<BotContext['reply']>[1]> &
  NonNullable<Parameters<BotContext['editMessageText']>[1]>;

const templateFieldByCode = (code: string): MessageTemplateField | null => {
  switch (code) {
    case 'k':
    case 'template_key':
      return 'template_key';
    case 'tp':
    case 'template_type':
      return 'template_type';
    case 'ti':
    case 'title':
      return 'title';
    case 'uz':
    case 'content_uz':
      return 'content_uz';
    case 'ru':
    case 'content_ru':
      return 'content_ru';
    default:
      return null;
  }
};

const adminTemplatePrompt = (locale: Locale, field: MessageTemplateField): string => {
  switch (field) {
    case 'template_key':
      return t(locale, 'adminTemplatePromptKey');
    case 'template_type':
      return t(locale, 'adminTemplatePromptType');
    case 'title':
      return t(locale, 'adminTemplatePromptTitle');
    case 'content_uz':
      return t(locale, 'adminTemplatePromptUz');
    case 'content_ru':
      return t(locale, 'adminTemplatePromptRu');
  }
};

const validateTemplateField = (
  field: MessageTemplateField,
  value: string,
): string | MessageTemplateType | null => {
  const trimmed = value.trim();
  switch (field) {
    case 'template_key':
      return /^[a-z][a-z0-9_:-]{1,119}$/.test(trimmed) ? trimmed : null;
    case 'template_type':
      return isMessageTemplateType(trimmed) ? trimmed : null;
    case 'title':
      return trimmed.length > 0 && trimmed.length <= 255 ? trimmed : null;
    case 'content_uz':
    case 'content_ru':
      return trimmed.length > 0 && trimmed.length <= 10_000 ? trimmed : null;
  }
};

const nextCreateTemplateField = (draft: MessageTemplateDraft): MessageTemplateField | null => {
  if (!draft.title) return 'title';
  if (!draft.template_key) return 'template_key';
  if (!draft.template_type) return 'template_type';
  if (!draft.content_uz) return 'content_uz';
  if (!draft.content_ru) return 'content_ru';
  return null;
};

const completeTemplateDraft = (draft: MessageTemplateDraft) => {
  if (
    !draft.template_key ||
    !draft.template_type ||
    !draft.title ||
    !draft.content_uz ||
    !draft.content_ru
  ) {
    return null;
  }

  return {
    template_key: draft.template_key,
    template_type: draft.template_type,
    title: draft.title,
    content_uz: draft.content_uz,
    content_ru: draft.content_ru,
  };
};

const formatTemplateList = (templates: MessageTemplate[], locale: Locale): string => {
  const rows = templates.map(
    (template) =>
      `${template.is_active ? '●' : '○'} ${escapeHtml(template.title)}\n` +
      `<code>${escapeHtml(template.template_key)}</code> · ${escapeHtml(template.template_type)}`,
  );

  return [
    `<b>${escapeHtml(t(locale, 'adminTemplatesTitle'))}</b>`,
    '',
    rows.length > 0 ? rows.join('\n\n') : escapeHtml(t(locale, 'adminTemplatesEmpty')),
  ].join('\n');
};

const formatTemplateDetail = (template: MessageTemplate): string =>
  [
    `<b>${escapeHtml(template.title)}</b>`,
    '',
    `<b>Key:</b> <code>${escapeHtml(template.template_key)}</code>`,
    `<b>Type:</b> ${escapeHtml(template.template_type)}`,
    `<b>Status:</b> ${template.is_active ? 'active' : 'inactive'}`,
    '',
    '<b>UZ:</b>',
    escapeHtml(template.content_uz),
    '',
    '<b>RU:</b>',
    escapeHtml(template.content_ru),
  ].join('\n');

const isMessageNotModifiedError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const description =
    'description' in error && typeof error.description === 'string'
      ? error.description
      : 'message' in error && typeof error.message === 'string'
        ? error.message
        : '';
  return description.toLowerCase().includes('message is not modified');
};

const replyOrEditTemplateWindow = async (
  ctx: BotContext,
  text: string,
  options: TemplateWindowOptions,
  preferEdit: boolean,
): Promise<void> => {
  if (!preferEdit || !ctx.callbackQuery?.message) {
    await ctx.reply(text, options);
    return;
  }

  try {
    await ctx.editMessageText(text, options);
  } catch (error) {
    if (isMessageNotModifiedError(error)) return;
    await ctx.reply(text, options);
  }
};

const showAdminTemplateList = async (
  ctx: BotContext,
  store: MessageTemplateStore,
  options: { preferEdit?: boolean } = {},
): Promise<void> => {
  const templates = await store.listTemplates();
  await replyOrEditTemplateWindow(
    ctx,
    formatTemplateList(templates, ctx.session.locale),
    {
      parse_mode: 'HTML',
      reply_markup: adminTemplateListKeyboard(templates, ctx.session.locale),
    },
    options.preferEdit ?? false,
  );
};

const showAdminTemplateDetail = async (
  ctx: BotContext,
  store: MessageTemplateStore,
  templateId: string,
  options: { preferEdit?: boolean } = {},
): Promise<void> => {
  const template = await store.findTemplateById(templateId);
  if (!template) {
    await ctx.reply(t(ctx.session.locale, 'adminTemplateNotFound'));
    return;
  }

  await replyOrEditTemplateWindow(
    ctx,
    formatTemplateDetail(template),
    {
      parse_mode: 'HTML',
      reply_markup: adminTemplateDetailKeyboard(template, ctx.session.locale),
    },
    options.preferEdit ?? false,
  );
};

const promptTemplateInput = async (ctx: BotContext): Promise<void> => {
  const input = ctx.session.adminTemplateInput;
  if (!input) return;

  if (input.field === 'template_type') {
    await ctx.reply(adminTemplatePrompt(ctx.session.locale, input.field), {
      reply_markup: adminTemplateTypeKeyboard(ctx.session.locale),
    });
    return;
  }

  await ctx.reply(adminTemplatePrompt(ctx.session.locale, input.field), {
    parse_mode: 'HTML',
    reply_markup: adminTemplateCancelKeyboard(ctx.session.locale),
  });
};

const startTemplateCreate = async (ctx: BotContext): Promise<void> => {
  await ctx.reply(t(ctx.session.locale, 'adminTemplateGuidance'), {
    parse_mode: 'HTML',
  });
  ctx.session.adminTemplateInput = {
    mode: 'create',
    field: 'title',
    draft: {},
  };
  ctx.session.stage = 'admin_template_input';
  await promptTemplateInput(ctx);
};

const startTemplateEdit = async (
  ctx: BotContext,
  templateId: string,
  field: MessageTemplateField,
): Promise<void> => {
  ctx.session.adminTemplateInput = {
    mode: 'edit',
    templateId,
    field,
  };
  ctx.session.stage = 'admin_template_input';
  await promptTemplateInput(ctx);
};

const handleAdminTemplateInput = async (
  ctx: BotContext,
  store: MessageTemplateStore,
  logger: Logger,
  text: string,
): Promise<void> => {
  const input = ctx.session.adminTemplateInput;
  if (!input || ctx.session.stage !== 'admin_template_input') {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }

  if (text.trim() === t(ctx.session.locale, 'adminTemplateCancel')) {
    clearAdminTemplateFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'adminTemplateCancelled'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
    return;
  }

  const value = validateTemplateField(input.field, text);
  if (value === null) {
    await ctx.reply(t(ctx.session.locale, 'adminTemplateInvalidValue'), {
      reply_markup: adminTemplateCancelKeyboard(ctx.session.locale),
    });
    await promptTemplateInput(ctx);
    return;
  }

  try {
    if (input.mode === 'edit') {
      if (!input.templateId) {
        clearAdminTemplateFlow(ctx.session);
        await ctx.reply(t(ctx.session.locale, 'staleAction'));
        return;
      }
      const updated = await store.updateTemplate(input.templateId, { [input.field]: value });
      clearAdminTemplateFlow(ctx.session);
      if (!updated) {
        await ctx.reply(t(ctx.session.locale, 'adminTemplateNotFound'), {
          reply_markup: personalMenuKeyboard(ctx.session),
        });
        return;
      }
      await ctx.reply(t(ctx.session.locale, 'adminTemplateUpdated'), {
        reply_markup: personalMenuKeyboard(ctx.session),
      });
      await showAdminTemplateDetail(ctx, store, updated.id);
      return;
    }

    const draft = { ...(input.draft ?? {}), [input.field]: value } as MessageTemplateDraft;
    const nextField = nextCreateTemplateField(draft);
    if (nextField) {
      ctx.session.adminTemplateInput = {
        mode: 'create',
        field: nextField,
        draft,
      };
      await promptTemplateInput(ctx);
      return;
    }

    const completeDraft = completeTemplateDraft(draft);
    if (!completeDraft) {
      clearAdminTemplateFlow(ctx.session);
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    const created = await store.createTemplate(completeDraft);
    clearAdminTemplateFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'adminTemplateSaved'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
    await showAdminTemplateDetail(ctx, store, created.id);
  } catch (error) {
    logger.error('Failed to process admin template input', error);
    clearAdminTemplateFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'adminTemplateUnavailable'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
  }
};

const handleAdminTemplateTypeSelection = async (
  ctx: BotContext,
  store: MessageTemplateStore,
  logger: Logger,
  value: MessageTemplateType,
): Promise<void> => {
  await handleAdminTemplateInput(ctx, store, logger, value);
};

export const registerAdminTemplatesHandlers = (
  bot: Bot<BotContext>,
  dependencies: BotDependencies,
): void => {
  bot.hears([t('uz', 'adminTemplates'), t('ru', 'adminTemplates')], async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    try {
      clearSupportFlow(ctx.session);
      clearAdminTemplateFlow(ctx.session);
      clearAdminExportFlow(ctx.session);
      await showAdminTemplateList(ctx, dependencies.messageTemplateStore);
    } catch (error) {
      dependencies.logger.error('Failed to show admin template list', error);
      await ctx.reply(t(ctx.session.locale, 'adminTemplateUnavailable'), {
        reply_markup: personalMenuKeyboard(ctx.session),
      });
    }
  });

  bot.callbackQuery(['admin_templates_back', 'tmpl:l'], async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    try {
      clearAdminTemplateFlow(ctx.session);
      await showAdminTemplateList(ctx, dependencies.messageTemplateStore, { preferEdit: true });
    } catch (error) {
      dependencies.logger.error('Failed to show admin template list', error);
      await ctx.reply(t(ctx.session.locale, 'adminTemplateUnavailable'));
    }
  });

  bot.callbackQuery(['admin_template_create', 'tmpl:c'], async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    await startTemplateCreate(ctx);
  });

  bot.callbackQuery('admin:menu', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    clearAdminTemplateFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'employeeHelp'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
  });

  bot.callbackQuery(/^(?:atpd|tmpl:v):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const match = /^(?:atpd|tmpl:v):(\d+)$/.exec(ctx.callbackQuery.data);
    if (!match?.[1]) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    try {
      await showAdminTemplateDetail(ctx, dependencies.messageTemplateStore, match[1], {
        preferEdit: true,
      });
    } catch (error) {
      dependencies.logger.error('Failed to show admin template detail', error);
      await ctx.reply(t(ctx.session.locale, 'adminTemplateUnavailable'));
    }
  });

  bot.callbackQuery(/^tmpl:e:(\d+):(k|tp|ti|uz|ru)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const match = /^tmpl:e:(\d+):(k|tp|ti|uz|ru)$/.exec(ctx.callbackQuery.data);
    const field = match?.[2] ? templateFieldByCode(match[2]) : null;
    if (!match?.[1] || !field) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await startTemplateEdit(ctx, match[1], field);
  });

  bot.callbackQuery(
    /^ate:(\d+):(template_key|template_type|title|content_uz|content_ru)$/,
    async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!(await requireAdmin(ctx))) return;
      const match = /^ate:(\d+):(template_key|template_type|title|content_uz|content_ru)$/.exec(
        ctx.callbackQuery.data,
      );
      const field = match?.[2] ? templateFieldByCode(match[2]) : null;
      if (!match?.[1] || !field) {
        await ctx.reply(t(ctx.session.locale, 'staleAction'));
        return;
      }
      await startTemplateEdit(ctx, match[1], field);
    },
  );

  bot.callbackQuery(/^atts:([a-z0-9_]+|cancel)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const match = /^atts:([a-z0-9_]+|cancel)$/.exec(ctx.callbackQuery.data);
    const selected = match?.[1];
    if (selected === 'cancel') {
      clearAdminTemplateFlow(ctx.session);
      await ctx.reply(t(ctx.session.locale, 'adminTemplateCancelled'), {
        reply_markup: personalMenuKeyboard(ctx.session),
      });
      return;
    }
    if (!selected || !isMessageTemplateType(selected)) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    if (
      ctx.session.stage !== 'admin_template_input' ||
      ctx.session.adminTemplateInput?.field !== 'template_type'
    ) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await handleAdminTemplateTypeSelection(
      ctx,
      dependencies.messageTemplateStore,
      dependencies.logger,
      selected,
    );
  });

  bot.callbackQuery(/^(?:att|tmpl:t):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const match = /^(?:att|tmpl:t):(\d+)$/.exec(ctx.callbackQuery.data);
    if (!match?.[1]) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    try {
      const template = await dependencies.messageTemplateStore.findTemplateById(match[1]);
      if (!template) {
        await ctx.reply(t(ctx.session.locale, 'adminTemplateNotFound'));
        return;
      }
      const updated = await dependencies.messageTemplateStore.updateTemplate(template.id, {
        is_active: !template.is_active,
      });
      if (!updated) {
        await ctx.reply(t(ctx.session.locale, 'adminTemplateNotFound'));
        return;
      }
      await showAdminTemplateDetail(ctx, dependencies.messageTemplateStore, updated.id, {
        preferEdit: true,
      });
    } catch (error) {
      dependencies.logger.error('Failed to toggle admin template', error);
      await ctx.reply(t(ctx.session.locale, 'adminTemplateUnavailable'));
    }
  });

  bot.callbackQuery(/^(?:atdl|tmpl:d):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const match = /^(?:atdl|tmpl:d):(\d+)$/.exec(ctx.callbackQuery.data);
    if (!match?.[1]) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    try {
      const deleted = await dependencies.messageTemplateStore.deleteTemplate(match[1]);
      if (!deleted) {
        await ctx.reply(t(ctx.session.locale, 'adminTemplateNotFound'));
        return;
      }
      await showAdminTemplateList(ctx, dependencies.messageTemplateStore, { preferEdit: true });
    } catch (error) {
      dependencies.logger.error('Failed to delete admin template', error);
      await ctx.reply(t(ctx.session.locale, 'adminTemplateUnavailable'));
    }
  });

  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.stage === 'admin_template_input' && ctx.session.adminTemplateInput) {
      await handleAdminTemplateInput(
        ctx,
        dependencies.messageTemplateStore,
        dependencies.logger,
        ctx.message.text,
      );
      return;
    }
    await next();
  });
};
