import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import type { BotDependencies } from '../create-bot.js';
import { t } from '../messages.js';
import { escapeHtml } from '../../utils/html.js';
import {
  BotNotificationService,
  isTelegramBlockedError,
} from '../../services/bot-notification.service.js';
import { MessageTemplateRenderer } from '../../services/message-template.service.js';
import {
  clearAdminClientFlow,
  clearAdminExportFlow,
  clearAdminTemplateFlow,
  clearSupportFlow,
} from '../session.js';
import { hasEmployeeMenuAccess } from '../helpers.js';
import {
  adminClientCancelKeyboard,
  adminClientCardKeyboard,
  adminClientCustomConfirmKeyboard,
  adminClientResultsKeyboard,
  adminClientTemplateConfirmKeyboard,
  adminClientTemplateListKeyboard,
  personalMenuKeyboard,
} from '../keyboards.js';

export const requireAdmin = async (ctx: BotContext): Promise<boolean> => {
  if (hasEmployeeMenuAccess(ctx.session)) return true;
  await ctx.reply(t(ctx.session.locale, 'staleAction'));
  return false;
};

const AUTO_PLACEHOLDERS = new Set([
  'customer_name',
  'first_name',
  'last_name',
  'phone_number',
  'client_id',
  'customer_code',
]);

const getTemplatePlaceholders = (content: string): string[] => {
  const matches = content.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
  const placeholders = new Set<string>();
  for (const match of matches) {
    if (match[1]) {
      placeholders.add(match[1]);
    }
  }
  return Array.from(placeholders);
};

const startAdminClientSearch = async (ctx: BotContext): Promise<void> => {
  clearAdminClientFlow(ctx.session);
  ctx.session.stage = 'admin_client_search_input';
  ctx.session.adminClientFlow = {};
  await ctx.reply(t(ctx.session.locale, 'adminClientSearchPrompt'), {
    reply_markup: adminClientCancelKeyboard(ctx.session.locale),
  });
};

const handleAdminClientSearchInput = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  query: string,
): Promise<void> => {
  const trimmed = query.trim();
  if (!trimmed) {
    await ctx.reply(t(ctx.session.locale, 'adminClientSearchPrompt'), {
      reply_markup: adminClientCancelKeyboard(ctx.session.locale),
    });
    return;
  }

  try {
    const clients = await dependencies.registeredUserStore.searchClients(trimmed);
    if (clients.length === 0) {
      await ctx.reply(t(ctx.session.locale, 'adminClientNotFound'), {
        reply_markup: adminClientCancelKeyboard(ctx.session.locale),
      });
      return;
    }

    ctx.session.adminClientFlow = {
      ...ctx.session.adminClientFlow,
      searchQuery: trimmed,
      searchResults: clients,
    };

    await ctx.reply(t(ctx.session.locale, 'adminClientListTitle'), {
      reply_markup: adminClientResultsKeyboard(clients, ctx.session.locale),
    });
  } catch (error) {
    dependencies.logger.error('Failed to search clients', error);
    await ctx.reply(t(ctx.session.locale, 'adminClientSearchFailed'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
  }
};

const showAdminClientCard = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  telegramId: string,
): Promise<void> => {
  try {
    let clientState = ctx.session.adminClientFlow?.searchResults?.find(
      (c) => c.user.telegram_id === telegramId,
    );
    if (!clientState) {
      const state = await dependencies.registeredUserStore.findByTelegramId(telegramId);
      if (state && state.client) {
        clientState = state;
      }
    }

    if (!clientState) {
      await ctx.reply(t(ctx.session.locale, 'adminClientNotFound'));
      return;
    }

    ctx.session.stage = 'settings';
    ctx.session.adminClientFlow = {
      ...ctx.session.adminClientFlow,
      selectedTelegramId: telegramId,
    };

    const fullName = `${clientState.user.first_name}${clientState.user.last_name ? ` ${clientState.user.last_name}` : ''}`;
    const cardText = [
      `👤 <b>F.I.O.:</b> ${escapeHtml(fullName)}`,
      `📞 <b>Telefon:</b> ${escapeHtml(clientState.user.phone_number)}`,
      `🌐 <b>Til:</b> ${escapeHtml(clientState.user.locale)}`,
      `🆔 <b>Telegram ID:</b> <code>${escapeHtml(clientState.user.telegram_id)}</code>`,
      `🔖 <b>Username:</b> ${clientState.user.telegram_username ? `@${escapeHtml(clientState.user.telegram_username)}` : 'yo‘q'}`,
      `🏢 <b>CRM Client ID:</b> <code>${escapeHtml(clientState.client?.crm_client_id ?? '')}</code>`,
      `🏷 <b>Mijoz kodi:</b> <code>${escapeHtml(clientState.client?.customer_code ?? '')}</code>`,
      `⚡️ <b>Holat:</b> ${escapeHtml(clientState.client?.status ?? '')}`,
    ].join('\n');

    await ctx.reply(cardText, {
      parse_mode: 'HTML',
      reply_markup: adminClientCardKeyboard(telegramId, ctx.session.locale),
    });
  } catch (error) {
    dependencies.logger.error('Failed to show admin client card', error);
    await ctx.reply(t(ctx.session.locale, 'unavailable'));
  }
};

const startAdminClientCustomMessage = async (
  ctx: BotContext,
  telegramId: string,
): Promise<void> => {
  ctx.session.stage = 'admin_client_send_custom_message';
  ctx.session.adminClientFlow = {
    ...ctx.session.adminClientFlow,
    selectedTelegramId: telegramId,
    customMessageText: undefined,
  };
  await ctx.reply(t(ctx.session.locale, 'adminClientCustomPrompt'), {
    reply_markup: adminClientCancelKeyboard(ctx.session.locale),
  });
};

const handleAdminClientCustomMessageInput = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  text: string,
): Promise<void> => {
  const trimmed = text.trim();
  if (!trimmed) {
    await ctx.reply(t(ctx.session.locale, 'adminClientCustomPrompt'), {
      reply_markup: adminClientCancelKeyboard(ctx.session.locale),
    });
    return;
  }

  const telegramId = ctx.session.adminClientFlow?.selectedTelegramId;
  if (!telegramId) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }

  ctx.session.adminClientFlow = {
    ...ctx.session.adminClientFlow,
    customMessageText: trimmed,
  };

  const previewText = `${t(ctx.session.locale, 'adminClientCustomPreview')}\n\n${escapeHtml(trimmed)}`;
  await ctx.reply(previewText, {
    parse_mode: 'HTML',
    reply_markup: adminClientCustomConfirmKeyboard(telegramId, ctx.session.locale),
  });
};

const sendAdminClientCustomMessage = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  telegramId: string,
): Promise<void> => {
  const text = ctx.session.adminClientFlow?.customMessageText;
  if (!text) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }

  let userState = ctx.session.adminClientFlow?.searchResults?.find(
    (c) => c.user.telegram_id === telegramId,
  );
  if (!userState) {
    userState = (await dependencies.registeredUserStore.findByTelegramId(telegramId)) ?? undefined;
  }

  const userId = userState?.user.id;

  try {
    await ctx.api.sendMessage(telegramId, text);
    await dependencies.messageTemplateStore.setUserBlocked(telegramId, false);
    await dependencies.messageTemplateStore.logDispatch({
      user_id: userId ? String(userId) : null,
      template_id: null,
      dispatch_type: 'admin_custom_message',
      status: 'sent',
      error_message: null,
    });
    await ctx.reply(t(ctx.session.locale, 'adminClientMessageSent'));
  } catch (error) {
    if (isTelegramBlockedError(error)) {
      await dependencies.messageTemplateStore.setUserBlocked(telegramId, true);
    }
    await dependencies.messageTemplateStore.logDispatch({
      user_id: userId ? String(userId) : null,
      template_id: null,
      dispatch_type: 'admin_custom_message',
      status: 'failed',
      error_message: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply(t(ctx.session.locale, 'adminClientMessageFailed'));
  }

  await showAdminClientCard(ctx, dependencies, telegramId);
};

const startAdminClientTemplateMessage = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  telegramId: string,
): Promise<void> => {
  try {
    const templates = await dependencies.messageTemplateStore.listTemplates();
    const activeTemplates = templates.filter((t) => t.is_active);
    await ctx.reply(t(ctx.session.locale, 'adminClientTemplateSelectPrompt'), {
      reply_markup: adminClientTemplateListKeyboard(
        activeTemplates,
        telegramId,
        ctx.session.locale,
      ),
    });
  } catch (error) {
    dependencies.logger.error('Failed to list templates for admin client', error);
    await ctx.reply(t(ctx.session.locale, 'unavailable'));
  }
};

const handleAdminClientTemplateSelect = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  telegramId: string,
  templateId: string,
): Promise<void> => {
  try {
    const template = await dependencies.messageTemplateStore.findTemplateById(templateId);
    if (!template) {
      await ctx.reply(t(ctx.session.locale, 'adminTemplateNotFound'));
      return;
    }

    let clientState = ctx.session.adminClientFlow?.searchResults?.find(
      (c) => c.user.telegram_id === telegramId,
    );
    if (!clientState) {
      clientState =
        (await dependencies.registeredUserStore.findByTelegramId(telegramId)) ?? undefined;
    }

    if (!clientState) {
      await ctx.reply(t(ctx.session.locale, 'adminClientNotFound'));
      return;
    }

    const locale = clientState.user.locale || 'uz';
    const content = locale === 'ru' ? template.content_ru : template.content_uz;
    const allPlaceholders = getTemplatePlaceholders(content);

    const fullName = `${clientState.user.first_name}${clientState.user.last_name ? ` ${clientState.user.last_name}` : ''}`;
    const promptedPlaceholders: Record<string, string> = {
      customer_name: fullName,
      first_name: clientState.user.first_name,
      last_name: clientState.user.last_name || '',
      phone_number: clientState.user.phone_number,
      client_id: clientState.client?.crm_client_id || '',
      customer_code: clientState.client?.customer_code || '',
    };

    const remaining = allPlaceholders.filter((p) => !AUTO_PLACEHOLDERS.has(p));

    ctx.session.adminClientFlow = {
      ...ctx.session.adminClientFlow,
      selectedTelegramId: telegramId,
      selectedTemplateId: templateId,
      placeholdersToPrompt: remaining,
      promptedPlaceholders,
    };

    if (remaining.length > 0) {
      ctx.session.stage = 'admin_client_template_placeholder';
      await promptTemplatePlaceholder(ctx);
    } else {
      await showAdminClientTemplatePreview(ctx, dependencies);
    }
  } catch (error) {
    dependencies.logger.error('Failed to handle template selection', error);
    await ctx.reply(t(ctx.session.locale, 'unavailable'));
  }
};

const promptTemplatePlaceholder = async (ctx: BotContext): Promise<void> => {
  const flow = ctx.session.adminClientFlow;
  if (!flow || !flow.placeholdersToPrompt || flow.placeholdersToPrompt.length === 0) return;

  const currentKey = flow.placeholdersToPrompt[0] as string;
  await ctx.reply(
    t(ctx.session.locale, 'adminClientTemplatePlaceholderPrompt', { key: currentKey }),
    {
      parse_mode: 'HTML',
      reply_markup: adminClientCancelKeyboard(ctx.session.locale),
    },
  );
};

const handleAdminClientTemplatePlaceholderInput = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  text: string,
): Promise<void> => {
  const flow = ctx.session.adminClientFlow;
  if (!flow || !flow.placeholdersToPrompt || flow.placeholdersToPrompt.length === 0) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }

  const currentKey = flow.placeholdersToPrompt[0] as string;
  flow.promptedPlaceholders = flow.promptedPlaceholders || {};
  flow.promptedPlaceholders[currentKey] = text;
  flow.placeholdersToPrompt.shift();

  if (flow.placeholdersToPrompt.length > 0) {
    await promptTemplatePlaceholder(ctx);
  } else {
    await showAdminClientTemplatePreview(ctx, dependencies);
  }
};

const showAdminClientTemplatePreview = async (
  ctx: BotContext,
  dependencies: BotDependencies,
): Promise<void> => {
  const flow = ctx.session.adminClientFlow;
  if (!flow || !flow.selectedTemplateId || !flow.selectedTelegramId) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }

  const template = await dependencies.messageTemplateStore.findTemplateById(
    flow.selectedTemplateId,
  );
  if (!template) {
    await ctx.reply(t(ctx.session.locale, 'adminTemplateNotFound'));
    return;
  }

  let clientState = flow.searchResults?.find((c) => c.user.telegram_id === flow.selectedTelegramId);
  if (!clientState) {
    clientState =
      (await dependencies.registeredUserStore.findByTelegramId(flow.selectedTelegramId)) ??
      undefined;
  }

  const locale = clientState?.user.locale || 'uz';
  const rendered = MessageTemplateRenderer.render(
    template,
    locale,
    flow.promptedPlaceholders || {},
  );

  const preview = `${t(ctx.session.locale, 'adminClientTemplatePreview')}\n\n${rendered}`;
  ctx.session.stage = 'settings';

  await ctx.reply(preview, {
    parse_mode: 'HTML',
    reply_markup: adminClientTemplateConfirmKeyboard(
      flow.selectedTelegramId,
      template.id,
      ctx.session.locale,
    ),
  });
};

const sendAdminClientTemplateMessage = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  telegramId: string,
  templateId: string,
): Promise<void> => {
  const flow = ctx.session.adminClientFlow;
  if (!flow || !flow.promptedPlaceholders) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }

  let clientState = flow.searchResults?.find((c) => c.user.telegram_id === telegramId);
  if (!clientState) {
    clientState =
      (await dependencies.registeredUserStore.findByTelegramId(telegramId)) ?? undefined;
  }

  if (!clientState) {
    await ctx.reply(t(ctx.session.locale, 'adminClientNotFound'));
    return;
  }

  try {
    const notificationService = new BotNotificationService(
      dependencies.messageTemplateStore,
      ctx.api,
    );

    const template = await dependencies.messageTemplateStore.findTemplateById(templateId);
    if (!template) {
      await ctx.reply(t(ctx.session.locale, 'adminTemplateNotFound'));
      return;
    }

    const result = await notificationService.sendTemplateMessage({
      user: {
        id: clientState.user.id || null,
        telegram_id: telegramId,
        language_code: clientState.user.locale,
        is_blocked: null,
      },
      type: template.template_type,
      placeholders: flow.promptedPlaceholders,
      dispatchType: 'admin_client_send_template',
    });

    if (result.status === 'sent') {
      await ctx.reply(t(ctx.session.locale, 'adminClientMessageSent'));
    } else {
      await ctx.reply(t(ctx.session.locale, 'adminClientMessageFailed'));
    }
  } catch (error) {
    dependencies.logger.error('Failed to send template message via admin flow', error);
    await ctx.reply(t(ctx.session.locale, 'adminClientMessageFailed'));
  }

  await showAdminClientCard(ctx, dependencies, telegramId);
};

export const registerAdminClientsHandlers = (
  bot: Bot<BotContext>,
  dependencies: BotDependencies,
): void => {
  bot.hears([t('uz', 'adminClients'), t('ru', 'adminClients')], async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    clearSupportFlow(ctx.session);
    clearAdminTemplateFlow(ctx.session);
    clearAdminExportFlow(ctx.session);
    clearAdminClientFlow(ctx.session);
    await startAdminClientSearch(ctx);
  });

  bot.callbackQuery('ac:search', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    await startAdminClientSearch(ctx);
  });

  bot.callbackQuery(/^ac:v:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const match = /^ac:v:(\d+)$/.exec(ctx.callbackQuery.data);
    if (!match?.[1]) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await showAdminClientCard(ctx, dependencies, match[1]);
  });

  bot.callbackQuery(/^ac:msg:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const match = /^ac:msg:(\d+)$/.exec(ctx.callbackQuery.data);
    if (!match?.[1]) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await startAdminClientCustomMessage(ctx, match[1]);
  });

  bot.callbackQuery(/^ac:tmpl:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const match = /^ac:tmpl:(\d+)$/.exec(ctx.callbackQuery.data);
    if (!match?.[1]) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await startAdminClientTemplateMessage(ctx, dependencies, match[1]);
  });

  bot.callbackQuery(/^ac:tmpl_sel:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const match = /^ac:tmpl_sel:(\d+):(\d+)$/.exec(ctx.callbackQuery.data);
    if (!match?.[1] || !match?.[2]) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await handleAdminClientTemplateSelect(ctx, dependencies, match[1], match[2]);
  });

  bot.callbackQuery(/^ac:tmpl_send:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const match = /^ac:tmpl_send:(\d+):(\d+)$/.exec(ctx.callbackQuery.data);
    if (!match?.[1] || !match?.[2]) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await sendAdminClientTemplateMessage(ctx, dependencies, match[1], match[2]);
  });

  bot.callbackQuery(/^ac:custom_send:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const match = /^ac:custom_send:(\d+)$/.exec(ctx.callbackQuery.data);
    if (!match?.[1]) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await sendAdminClientCustomMessage(ctx, dependencies, match[1]);
  });

  bot.callbackQuery('ac:cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const telegramId = ctx.session.adminClientFlow?.selectedTelegramId;
    if (!telegramId) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await showAdminClientCard(ctx, dependencies, telegramId);
  });

  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.stage === 'admin_client_search_input') {
      if (ctx.message.text === t(ctx.session.locale, 'adminClientCancel')) {
        clearAdminClientFlow(ctx.session);
        await ctx.reply(t(ctx.session.locale, 'adminTemplateCancelled'), {
          reply_markup: personalMenuKeyboard(ctx.session),
        });
        return;
      }
      await handleAdminClientSearchInput(ctx, dependencies, ctx.message.text);
      return;
    }

    if (ctx.session.stage === 'admin_client_send_custom_message') {
      if (ctx.message.text === t(ctx.session.locale, 'adminClientCancel')) {
        ctx.session.stage = 'settings';
        await showAdminClientCard(
          ctx,
          dependencies,
          ctx.session.adminClientFlow?.selectedTelegramId ?? '',
        );
        return;
      }
      await handleAdminClientCustomMessageInput(ctx, dependencies, ctx.message.text);
      return;
    }

    if (ctx.session.stage === 'admin_client_template_placeholder') {
      if (ctx.message.text === t(ctx.session.locale, 'adminClientCancel')) {
        ctx.session.stage = 'settings';
        await showAdminClientCard(
          ctx,
          dependencies,
          ctx.session.adminClientFlow?.selectedTelegramId ?? '',
        );
        return;
      }
      await handleAdminClientTemplatePlaceholderInput(ctx, dependencies, ctx.message.text);
      return;
    }

    await next();
  });
};
