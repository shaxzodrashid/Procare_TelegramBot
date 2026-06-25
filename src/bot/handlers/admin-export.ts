import { InputFile, type Bot } from 'grammy';

import type { ActionExportPeriod } from '../../services/action-export.service.js';
import type { BotContext } from '../context.js';
import type { BotDependencies } from '../create-bot.js';
import { t } from '../messages.js';
import { adminExportCancelKeyboard, personalMenuKeyboard } from '../keyboards.js';
import {
  clearAdminClientFlow,
  clearAdminExportFlow,
  clearAdminTemplateFlow,
  clearSupportFlow,
} from '../session.js';
import { requireAdmin } from './admin-clients.js';

type PeriodParseResult =
  | { status: 'ok'; period: ActionExportPeriod }
  | { status: 'invalid' }
  | { status: 'start_after_end' };

const DATE_PATTERN = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

const isValidDateParts = (year: number, month: number, day: number): boolean => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

const tashkentStartOfDate = (dateLabel: string): Date => new Date(`${dateLabel}T00:00:00+05:00`);

const addUtcDays = (date: Date, days: number): Date => {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
};

export const parseAdminExportPeriod = (text: string): PeriodParseResult => {
  const matches = Array.from(text.matchAll(DATE_PATTERN));
  if (matches.length !== 2) return { status: 'invalid' };

  const labels = matches.map((match) => {
    const [label, year, month, day] = match;
    const yearNumber = Number(year);
    const monthNumber = Number(month);
    const dayNumber = Number(day);
    return {
      label,
      valid: isValidDateParts(yearNumber, monthNumber, dayNumber),
    };
  });

  const from = labels[0];
  const to = labels[1];
  if (!from?.valid || !to?.valid) return { status: 'invalid' };

  const fromDate = tashkentStartOfDate(from.label);
  const toDate = tashkentStartOfDate(to.label);
  if (fromDate > toDate) return { status: 'start_after_end' };

  return {
    status: 'ok',
    period: {
      from: fromDate,
      toExclusive: addUtcDays(toDate, 1),
      fromLabel: from.label,
      toLabel: to.label,
    },
  };
};

const startAdminExport = async (ctx: BotContext): Promise<void> => {
  clearSupportFlow(ctx.session);
  clearAdminTemplateFlow(ctx.session);
  clearAdminClientFlow(ctx.session);
  ctx.session.stage = 'admin_export_period_input';
  await ctx.reply(t(ctx.session.locale, 'adminExportPrompt'), {
    parse_mode: 'HTML',
    reply_markup: adminExportCancelKeyboard(ctx.session.locale),
  });
};

const handleAdminExportPeriod = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  text: string,
): Promise<void> => {
  if (text === t(ctx.session.locale, 'adminExportCancel')) {
    clearAdminExportFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'adminExportCancelled'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
    return;
  }

  const parsed = parseAdminExportPeriod(text);
  if (parsed.status === 'invalid') {
    await ctx.reply(t(ctx.session.locale, 'adminExportInvalidPeriod'), {
      parse_mode: 'HTML',
      reply_markup: adminExportCancelKeyboard(ctx.session.locale),
    });
    return;
  }
  if (parsed.status === 'start_after_end') {
    await ctx.reply(t(ctx.session.locale, 'adminExportStartAfterEnd'), {
      reply_markup: adminExportCancelKeyboard(ctx.session.locale),
    });
    return;
  }

  if (!dependencies.actionExportService) {
    dependencies.logger.error('Action export service is not configured');
    await ctx.reply(t(ctx.session.locale, 'adminExportUnavailable'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
    return;
  }

  await ctx.reply(t(ctx.session.locale, 'adminExportGenerating'));

  try {
    const result = await dependencies.actionExportService.exportActions(parsed.period);
    dependencies.logger.info('Employee Excel action export generated', {
      from: parsed.period.fromLabel,
      to: parsed.period.toLabel,
      rowCounts: result.rowCounts,
    });
    await ctx.replyWithDocument(new InputFile(result.buffer, result.fileName), {
      caption: t(ctx.session.locale, 'adminExportReady', {
        from: parsed.period.fromLabel,
        to: parsed.period.toLabel,
      }),
      reply_markup: personalMenuKeyboard(ctx.session),
    });
    clearAdminExportFlow(ctx.session);
  } catch (error) {
    dependencies.logger.error('Failed to generate employee Excel action export', error);
    clearAdminExportFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'adminExportUnavailable'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
  }
};

export const registerAdminExportHandlers = (
  bot: Bot<BotContext>,
  dependencies: BotDependencies,
): void => {
  bot.command('export', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await startAdminExport(ctx);
  });

  bot.hears([t('uz', 'adminExport'), t('ru', 'adminExport')], async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await startAdminExport(ctx);
  });

  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.stage === 'admin_export_period_input') {
      if (!(await requireAdmin(ctx))) return;
      await handleAdminExportPeriod(ctx, dependencies, ctx.message.text);
      return;
    }

    await next();
  });
};
