import type { Bot } from 'grammy';

import type { BotContext } from '../context.js';
import type { BotDependencies } from '../create-bot.js';
import type { ApiErrorLocalizationStore } from '../../services/api-error-localization.service.js';
import { hasDeveloperMenuAccess } from '../helpers.js';
import {
  developerCancelKeyboard,
  developerEndpointDetailKeyboard,
  developerEndpointListKeyboard,
  developerLocalizationDetailKeyboard,
  personalMenuKeyboard,
} from '../keyboards.js';
import { t } from '../messages.js';
import { clearDeveloperFlow } from '../session.js';
import { validateApiErrorLocalizationInput } from '../../services/api-error-localization.service.js';
import type {
  ApiEndpointDescriptor,
  ApiErrorLocalization,
} from '../../types/api-error-localization.js';
import { escapeHtml } from '../../utils/html.js';

type DeveloperDependencies = BotDependencies & {
  apiErrorLocalizationStore: ApiErrorLocalizationStore;
};

const endpointByIndex = (
  endpoints: readonly ApiEndpointDescriptor[],
  rawIndex: string | undefined,
): { endpoint: ApiEndpointDescriptor; index: number } | null => {
  if (!rawIndex || !/^\d+$/.test(rawIndex)) return null;
  const index = Number(rawIndex);
  const endpoint = endpoints[index];
  return endpoint ? { endpoint, index } : null;
};

const formatEndpoint = (
  ctx: BotContext,
  endpoint: ApiEndpointDescriptor,
  localizations: ApiErrorLocalization[],
): string => {
  const base = t(ctx.session.locale, 'developerEndpointTitle', {
    title: escapeHtml(endpoint.title),
    method: endpoint.method,
    path: escapeHtml(endpoint.path),
    auth: endpoint.auth,
    description: escapeHtml(endpoint.description),
    count: String(localizations.length),
  });

  if (localizations.length > 0) return base;
  return `${base}\n\n${t(ctx.session.locale, 'developerEndpointEmpty')}`;
};

const formatLocalization = (ctx: BotContext, localization: ApiErrorLocalization): string =>
  t(ctx.session.locale, 'developerLocalizationTitle', {
    location: escapeHtml(localization.location),
    messageUz: escapeHtml(localization.message_uz),
    messageRu: escapeHtml(localization.message_ru),
  });

const showEndpointList = async (
  ctx: BotContext,
  dependencies: DeveloperDependencies,
): Promise<void> => {
  const endpoints = dependencies.apiErrorLocalizationStore.listEndpoints();
  await ctx.reply(t(ctx.session.locale, 'developerEndpointsTitle'), {
    reply_markup: developerEndpointListKeyboard(endpoints, ctx.session.locale),
  });
};

const showEndpointDetail = async (
  ctx: BotContext,
  dependencies: DeveloperDependencies,
  endpointIndex: number,
  endpoint: ApiEndpointDescriptor,
): Promise<void> => {
  const localizations = await dependencies.apiErrorLocalizationStore.listLocalizations(
    endpoint.key,
  );
  await ctx.reply(formatEndpoint(ctx, endpoint, localizations), {
    parse_mode: 'HTML',
    reply_markup: developerEndpointDetailKeyboard(endpointIndex, localizations, ctx.session.locale),
  });
};

const showLocalizationDetail = async (
  ctx: BotContext,
  dependencies: DeveloperDependencies,
  endpointIndex: number,
  endpoint: ApiEndpointDescriptor,
  localizationId: string,
): Promise<void> => {
  const localizations = await dependencies.apiErrorLocalizationStore.listLocalizations(
    endpoint.key,
  );
  const localization = localizations.find((item) => item.id === localizationId);
  if (!localization) {
    await ctx.reply(t(ctx.session.locale, 'developerLocalizationNotFound'));
    return;
  }

  await ctx.reply(formatLocalization(ctx, localization), {
    parse_mode: 'HTML',
    reply_markup: developerLocalizationDetailKeyboard(
      endpointIndex,
      localization.id,
      ctx.session.locale,
    ),
  });
};

const startLocalizationInput = async (
  ctx: BotContext,
  endpointKey: string,
  location?: string,
): Promise<void> => {
  ctx.session.developerFlow = { endpointKey, location };
  ctx.session.stage = location
    ? 'developer_error_message_uz_input'
    : 'developer_error_location_input';
  await ctx.reply(
    t(
      ctx.session.locale,
      location ? 'developerLocalizationPromptUz' : 'developerLocalizationPromptLocation',
    ),
    {
      parse_mode: 'HTML',
      reply_markup: developerCancelKeyboard(ctx.session.locale),
    },
  );
};

const handleDeveloperText = async (
  ctx: BotContext,
  dependencies: DeveloperDependencies,
): Promise<boolean> => {
  if (!ctx.message?.text || !hasDeveloperMenuAccess(ctx.session)) return false;
  const text = ctx.message.text.trim();

  if (
    ctx.session.stage !== 'developer_error_location_input' &&
    ctx.session.stage !== 'developer_error_message_uz_input' &&
    ctx.session.stage !== 'developer_error_message_ru_input'
  ) {
    return false;
  }

  if (text === t(ctx.session.locale, 'developerCancel')) {
    clearDeveloperFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'developerCancelled'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
    return true;
  }

  const flow = ctx.session.developerFlow;
  if (!flow?.endpointKey) {
    clearDeveloperFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'developerUnavailable'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
    return true;
  }

  if (ctx.session.stage === 'developer_error_location_input') {
    const probe = {
      endpoint_key: flow.endpointKey,
      location: text,
      message_uz: 'ok',
      message_ru: 'ok',
    };
    if (validateApiErrorLocalizationInput(probe).some((issue) => issue.startsWith('location'))) {
      await ctx.reply(t(ctx.session.locale, 'developerLocalizationInvalid'), {
        reply_markup: developerCancelKeyboard(ctx.session.locale),
      });
      return true;
    }
    ctx.session.developerFlow = { ...flow, location: text };
    ctx.session.stage = 'developer_error_message_uz_input';
    await ctx.reply(t(ctx.session.locale, 'developerLocalizationPromptUz'), {
      reply_markup: developerCancelKeyboard(ctx.session.locale),
    });
    return true;
  }

  if (ctx.session.stage === 'developer_error_message_uz_input') {
    if (text.length < 2 || text.length > 1000) {
      await ctx.reply(t(ctx.session.locale, 'developerLocalizationInvalid'), {
        reply_markup: developerCancelKeyboard(ctx.session.locale),
      });
      return true;
    }
    ctx.session.developerFlow = { ...flow, messageUz: text };
    ctx.session.stage = 'developer_error_message_ru_input';
    await ctx.reply(t(ctx.session.locale, 'developerLocalizationPromptRu'), {
      reply_markup: developerCancelKeyboard(ctx.session.locale),
    });
    return true;
  }

  if (!flow.location || !flow.messageUz || text.length < 2 || text.length > 1000) {
    await ctx.reply(t(ctx.session.locale, 'developerLocalizationInvalid'), {
      reply_markup: developerCancelKeyboard(ctx.session.locale),
    });
    return true;
  }

  try {
    await dependencies.apiErrorLocalizationStore.upsertLocalization({
      endpoint_key: flow.endpointKey,
      location: flow.location,
      message_uz: flow.messageUz,
      message_ru: text,
    });
    clearDeveloperFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'developerLocalizationSaved'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
  } catch (error) {
    dependencies.logger.error('Failed to save API error localization', error);
    await ctx.reply(t(ctx.session.locale, 'developerUnavailable'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
  }
  return true;
};

export const registerDeveloperHandlers = (
  bot: Bot<BotContext>,
  dependencies: DeveloperDependencies,
): void => {
  bot.hears([t('uz', 'developerApiEndpoints'), t('ru', 'developerApiEndpoints')], async (ctx) => {
    if (!hasDeveloperMenuAccess(ctx.session)) return;
    try {
      await showEndpointList(ctx, dependencies);
    } catch (error) {
      dependencies.logger.error('Failed to show developer endpoint list', error);
      await ctx.reply(t(ctx.session.locale, 'developerUnavailable'));
    }
  });

  bot.callbackQuery('dev:list', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!hasDeveloperMenuAccess(ctx.session)) return;
    await showEndpointList(ctx, dependencies);
  });

  bot.callbackQuery('dev:menu', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!hasDeveloperMenuAccess(ctx.session)) return;
    clearDeveloperFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'developerHelp'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
  });

  bot.callbackQuery(/^dev:e:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!hasDeveloperMenuAccess(ctx.session)) return;
    const match = /^dev:e:(\d+)$/.exec(ctx.callbackQuery.data);
    const selected = endpointByIndex(
      dependencies.apiErrorLocalizationStore.listEndpoints(),
      match?.[1],
    );
    if (!selected) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await showEndpointDetail(ctx, dependencies, selected.index, selected.endpoint);
  });

  bot.callbackQuery(/^dev:a:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!hasDeveloperMenuAccess(ctx.session)) return;
    const match = /^dev:a:(\d+)$/.exec(ctx.callbackQuery.data);
    const selected = endpointByIndex(
      dependencies.apiErrorLocalizationStore.listEndpoints(),
      match?.[1],
    );
    if (!selected) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await startLocalizationInput(ctx, selected.endpoint.key);
  });

  bot.callbackQuery(/^dev:l:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!hasDeveloperMenuAccess(ctx.session)) return;
    const match = /^dev:l:(\d+):(\d+)$/.exec(ctx.callbackQuery.data);
    const selected = endpointByIndex(
      dependencies.apiErrorLocalizationStore.listEndpoints(),
      match?.[1],
    );
    if (!selected || !match?.[2]) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await showLocalizationDetail(ctx, dependencies, selected.index, selected.endpoint, match[2]);
  });

  bot.callbackQuery(/^dev:edit:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!hasDeveloperMenuAccess(ctx.session)) return;
    const match = /^dev:edit:(\d+):(\d+)$/.exec(ctx.callbackQuery.data);
    const selected = endpointByIndex(
      dependencies.apiErrorLocalizationStore.listEndpoints(),
      match?.[1],
    );
    if (!selected || !match?.[2]) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    const localizations = await dependencies.apiErrorLocalizationStore.listLocalizations(
      selected.endpoint.key,
    );
    const localization = localizations.find((item) => item.id === match[2]);
    if (!localization) {
      await ctx.reply(t(ctx.session.locale, 'developerLocalizationNotFound'));
      return;
    }
    await startLocalizationInput(ctx, selected.endpoint.key, localization.location);
  });

  bot.on('message:text', async (ctx, next) => {
    const handled = await handleDeveloperText(ctx, dependencies);
    if (!handled) return next();
  });
};
