import type { Bot } from 'grammy';
import type { BotContext, RepairRequestDraft } from '../context.js';
import type { BotDependencies } from '../create-bot.js';
import type { UnknownClientDeclineReason } from '../../types/unknown-client.js';
import type { Locale } from '../../types/client.js';
import { RepairOrderError } from '../../services/repair-order.service.js';
import { t } from '../messages.js';
import {
  fullTelegramName,
} from '../helpers.js';
import {
  buildRepairDescription,
  formatCategoryPage,
  formatProblemList,
  formatRepairRequestSummary,
} from '../formatters.js';
import {
  categoryKeyboard,
  confirmationKeyboard,
  noteKeyboard,
  osTypesKeyboard,
  problemsKeyboard,
} from '../keyboards.js';
import { localizedCatalogName } from '../../types/repair-order.js';

const CATEGORY_PAGE_SIZE = 10;

const createDraft = (): RepairRequestDraft => ({
  osTypes: [],
  categoryPath: [],
  categories: [],
  categoryPage: 0,
  problems: [],
  selectedProblemIds: [],
  note: '',
  submitting: false,
});

const categoryMessage = (draft: RepairRequestDraft, locale: Locale): string => {
  const path = draft.categoryPath.map((item) => localizedCatalogName(item, locale)).join(' → ');
  const list = formatCategoryPage(draft.categories, draft.categoryPage, locale, CATEGORY_PAGE_SIZE);
  return [
    t(locale, 'chooseCategory'),
    path ? `\n${path}` : '',
    `\n${list || t(locale, 'noCategories')}`,
  ].join('');
};

const showConfirmation = async (ctx: BotContext): Promise<void> => {
  const unknown = ctx.session.unknownClient;
  const draft = ctx.session.repairDraft;
  if (!unknown || !draft || !draft.selectedCategory) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }

  ctx.session.stage = 'confirming_request';
  await ctx.reply(
    `${t(ctx.session.locale, 'confirmRequest')}\n\n${formatRepairRequestSummary(
      unknown,
      draft,
      ctx.session.locale,
    )}`,
    {
      parse_mode: 'HTML',
      reply_markup: confirmationKeyboard(ctx.session.locale),
    },
  );
};

const saveUnknownClient = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  reason: UnknownClientDeclineReason,
): Promise<void> => {
  const unknown = ctx.session.unknownClient;
  if (!unknown || !ctx.from) return;

  await dependencies.unknownClientStore.save({
    telegram_id: String(ctx.from.id),
    telegram_username: unknown.username,
    first_name: unknown.firstName,
    last_name: unknown.lastName,
    phone_number: unknown.phoneNumber,
    locale: ctx.session.locale,
    reason,
    saved_at: new Date().toISOString(),
  });
};

const acceptNote = async (ctx: BotContext, note: string): Promise<void> => {
  const draft = ctx.session.repairDraft;
  if (!draft || ctx.session.stage !== 'awaiting_note') {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }

  draft.note = note.trim();
  if (
    draft.note.length > 9_000 ||
    buildRepairDescription(draft, ctx.session.locale).length > 10_000
  ) {
    draft.note = '';
    await ctx.reply(t(ctx.session.locale, 'noteTooLong'), {
      reply_markup: noteKeyboard(ctx.session.locale),
    });
    return;
  }
  await showConfirmation(ctx);
};

export const registerUnknownFlowHandlers = (
  bot: Bot<BotContext>,
  dependencies: BotDependencies,
): void => {
  bot.callbackQuery('request:accept', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.session.stage !== 'offering_request' || !ctx.session.unknownClient) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    try {
      const osTypes = await dependencies.repairOrderService.getOsTypes();
      if (osTypes.length === 0) {
        await ctx.editMessageText(t(ctx.session.locale, 'noOsTypes'));
        return;
      }
      ctx.session.repairDraft = createDraft();
      ctx.session.repairDraft.osTypes = osTypes;
      ctx.session.stage = 'choosing_os';
      await ctx.editMessageText(t(ctx.session.locale, 'chooseOs'), {
        reply_markup: osTypesKeyboard(osTypes, ctx.session.locale),
      });
    } catch (error) {
      dependencies.logger.error('Failed to load OS types', error);
      await ctx.editMessageText(
        t(
          ctx.session.locale,
          error instanceof RepairOrderError && error.code === 'maintenance'
            ? 'maintenance'
            : 'requestUnavailable',
        ),
      );
    }
  });

  bot.callbackQuery('request:decline', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.session.stage !== 'offering_request' || !ctx.session.unknownClient) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    try {
      await saveUnknownClient(ctx, dependencies, 'declined_offer');
      ctx.session.stage = 'request_declined';
      await ctx.editMessageText(t(ctx.session.locale, 'requestDeclined'));
    } catch (error) {
      dependencies.logger.error('Failed to persist declined unknown client', error);
      await ctx.editMessageText(t(ctx.session.locale, 'requestUnavailable'));
    }
  });

  bot.callbackQuery(/^os:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const draft = ctx.session.repairDraft;
    const match = /^os:(\d+)$/.exec(ctx.callbackQuery.data);
    const selected = draft && match ? draft.osTypes[Number(match[1])] : undefined;
    if (ctx.session.stage !== 'choosing_os' || !draft || !selected) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    try {
      const categories = await dependencies.repairOrderService.getPhoneCategories(selected.id);
      draft.selectedOs = selected;
      draft.categoryPath = [];
      draft.categories = categories;
      draft.categoryPage = 0;
      ctx.session.stage = 'choosing_category';
      await ctx.editMessageText(categoryMessage(draft, ctx.session.locale), {
        reply_markup: categoryKeyboard(
          categories.length,
          0,
          ctx.session.locale,
          CATEGORY_PAGE_SIZE,
        ),
      });
    } catch (error) {
      dependencies.logger.error('Failed to load root phone categories', error);
      await ctx.reply(t(ctx.session.locale, 'requestUnavailable'));
    }
  });

  bot.callbackQuery(/^category-page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const draft = ctx.session.repairDraft;
    const match = /^category-page:(\d+)$/.exec(ctx.callbackQuery.data);
    const page = match ? Number(match[1]) : -1;
    const maxPage = draft
      ? Math.max(0, Math.ceil(draft.categories.length / CATEGORY_PAGE_SIZE) - 1)
      : 0;
    if (ctx.session.stage !== 'choosing_category' || !draft || page < 0 || page > maxPage) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    draft.categoryPage = page;
    await ctx.editMessageText(categoryMessage(draft, ctx.session.locale), {
      reply_markup: categoryKeyboard(
        draft.categories.length,
        page,
        ctx.session.locale,
        CATEGORY_PAGE_SIZE,
      ),
    });
  });

  bot.callbackQuery('category:back', async (ctx) => {
    await ctx.answerCallbackQuery();
    const draft = ctx.session.repairDraft;
    if (ctx.session.stage !== 'choosing_category' || !draft?.selectedOs) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    if (draft.categoryPath.length === 0) {
      ctx.session.stage = 'choosing_os';
      await ctx.editMessageText(t(ctx.session.locale, 'chooseOs'), {
        reply_markup: osTypesKeyboard(draft.osTypes, ctx.session.locale),
      });
      return;
    }

    draft.categoryPath.pop();
    const parent = draft.categoryPath.at(-1);
    try {
      draft.categories = await dependencies.repairOrderService.getPhoneCategories(
        draft.selectedOs.id,
        parent?.id,
      );
      draft.categoryPage = 0;
      await ctx.editMessageText(categoryMessage(draft, ctx.session.locale), {
        reply_markup: categoryKeyboard(
          draft.categories.length,
          0,
          ctx.session.locale,
          CATEGORY_PAGE_SIZE,
        ),
      });
    } catch (error) {
      dependencies.logger.error('Failed to navigate back through phone categories', error);
      await ctx.reply(t(ctx.session.locale, 'requestUnavailable'));
    }
  });

  bot.callbackQuery(/^category:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const draft = ctx.session.repairDraft;
    const match = /^category:(\d+)$/.exec(ctx.callbackQuery.data);
    const selected = draft && match ? draft.categories[Number(match[1])] : undefined;
    if (ctx.session.stage !== 'choosing_category' || !draft?.selectedOs || !selected) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    try {
      if (selected.has_children) {
        draft.categoryPath.push(selected);
        draft.categories = await dependencies.repairOrderService.getPhoneCategories(
          draft.selectedOs.id,
          selected.id,
        );
        draft.categoryPage = 0;
        await ctx.editMessageText(categoryMessage(draft, ctx.session.locale), {
          reply_markup: categoryKeyboard(
            draft.categories.length,
            0,
            ctx.session.locale,
            CATEGORY_PAGE_SIZE,
          ),
        });
        return;
      }

      draft.selectedCategory = selected;
      draft.problems = await dependencies.repairOrderService.getProblemCategories(selected.id);
      draft.selectedProblemIds = [];
      ctx.session.stage = 'choosing_problems';
      const problemList = formatProblemList(draft.problems, ctx.session.locale);
      await ctx.editMessageText(
        `${t(ctx.session.locale, 'chooseProblems')}\n\n${
          problemList || t(ctx.session.locale, 'emptyProblems')
        }`,
        {
          reply_markup: problemsKeyboard(
            draft.problems,
            draft.selectedProblemIds,
            ctx.session.locale,
          ),
        },
      );
    } catch (error) {
      dependencies.logger.error('Failed to load phone category children or problems', error);
      await ctx.reply(t(ctx.session.locale, 'requestUnavailable'));
    }
  });

  bot.callbackQuery('problem:back', async (ctx) => {
    await ctx.answerCallbackQuery();
    const draft = ctx.session.repairDraft;
    if (ctx.session.stage !== 'choosing_problems' || !draft) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    delete draft.selectedCategory;
    draft.problems = [];
    draft.selectedProblemIds = [];
    ctx.session.stage = 'choosing_category';
    await ctx.editMessageText(categoryMessage(draft, ctx.session.locale), {
      reply_markup: categoryKeyboard(
        draft.categories.length,
        draft.categoryPage,
        ctx.session.locale,
        CATEGORY_PAGE_SIZE,
      ),
    });
  });

  bot.callbackQuery('problem:done', async (ctx) => {
    await ctx.answerCallbackQuery();
    const draft = ctx.session.repairDraft;
    if (ctx.session.stage !== 'choosing_problems' || !draft?.selectedCategory) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    ctx.session.stage = 'awaiting_note';
    await ctx.editMessageText(
      `${t(ctx.session.locale, 'chooseProblems')}\n\n${
        formatProblemList(draft.problems, ctx.session.locale) ||
        t(ctx.session.locale, 'emptyProblems')
      }`,
    );
    await ctx.reply(t(ctx.session.locale, 'enterNote'), {
      reply_markup: noteKeyboard(ctx.session.locale),
    });
  });

  bot.callbackQuery(/^problem:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const draft = ctx.session.repairDraft;
    const match = /^problem:(\d+)$/.exec(ctx.callbackQuery.data);
    const problem = draft && match ? draft.problems[Number(match[1])] : undefined;
    if (ctx.session.stage !== 'choosing_problems' || !draft || !problem) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    draft.selectedProblemIds = draft.selectedProblemIds.includes(problem.id)
      ? draft.selectedProblemIds.filter((id) => id !== problem.id)
      : [...draft.selectedProblemIds, problem.id];
    await ctx.editMessageText(
      `${t(ctx.session.locale, 'chooseProblems')}\n\n${formatProblemList(
        draft.problems,
        ctx.session.locale,
      )}`,
      {
        reply_markup: problemsKeyboard(
          draft.problems,
          draft.selectedProblemIds,
          ctx.session.locale,
        ),
      },
    );
  });

  bot.callbackQuery('confirm:no', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.session.stage !== 'confirming_request' || !ctx.session.unknownClient) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    try {
      await saveUnknownClient(ctx, dependencies, 'cancelled_confirmation');
      ctx.session.stage = 'request_declined';
      await ctx.editMessageText(t(ctx.session.locale, 'requestCancelled'));
    } catch (error) {
      dependencies.logger.error('Failed to persist cancelled unknown client', error);
      await ctx.reply(t(ctx.session.locale, 'requestUnavailable'));
    }
  });

  bot.callbackQuery('confirm:yes', async (ctx) => {
    await ctx.answerCallbackQuery();
    const unknown = ctx.session.unknownClient;
    const draft = ctx.session.repairDraft;
    if (
      ctx.session.stage !== 'confirming_request' ||
      !unknown ||
      !draft?.selectedCategory ||
      draft.submitting
    ) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    draft.submitting = true;
    await ctx.editMessageText(t(ctx.session.locale, 'submittingRequest'));
    try {
      const result = await dependencies.repairOrderService.createOpenRepairOrder({
        name: fullTelegramName(ctx),
        phone_number: unknown.phoneNumber,
        phone_category: draft.selectedCategory.id,
        description: buildRepairDescription(draft, ctx.session.locale),
      });
      ctx.session.stage = 'request_submitted';
      await ctx.editMessageText(
        t(ctx.session.locale, 'requestCreated', { number: result.number_id }),
      );
    } catch (error) {
      draft.submitting = false;
      dependencies.logger.error('Failed to create public repair order', error);
      const messageKey =
        error instanceof RepairOrderError
          ? error.code === 'rate_limited'
            ? 'requestRateLimited'
            : error.code === 'maintenance'
              ? 'maintenance'
              : 'requestUnavailable'
          : 'requestUnavailable';
      await ctx.editMessageText(
        `${t(ctx.session.locale, messageKey)}\n\n${formatRepairRequestSummary(
          unknown,
          draft,
          ctx.session.locale,
        )}`,
        {
          parse_mode: 'HTML',
          reply_markup: confirmationKeyboard(ctx.session.locale),
        },
      );
    }
  });

  // Awaiting note text handler
  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.stage !== 'awaiting_note') {
      return next();
    }
    await acceptNote(
      ctx,
      ctx.message.text === t(ctx.session.locale, 'skipNote') ? '' : ctx.message.text,
    );
  });
};
