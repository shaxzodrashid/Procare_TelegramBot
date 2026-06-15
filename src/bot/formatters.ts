import type { Locale, RepairOrder } from '../types/client.js';
import type { PhoneCategory, ProblemCategory } from '../types/repair-order.js';
import { localizedCatalogName } from '../types/repair-order.js';
import { escapeHtml } from '../utils/html.js';
import type { RepairRequestDraft, UnknownClientSession } from './context.js';

const localizedName = (
  reference: RepairOrder['branch'] | RepairOrder['repair_order_status'],
  locale: Locale,
): string => reference[locale === 'ru' ? 'name_ru' : 'name_uz'] ?? reference.name_en ?? '-';

export const formatRepairOrders = (orders: RepairOrder[], locale: Locale): string =>
  orders
    .map((order, index) => {
      const category =
        order.phone_category[locale === 'ru' ? 'name_ru' : 'name_uz'] ??
        order.phone_category.name_en ??
        '-';
      const status = localizedName(order.repair_order_status, locale);
      const branch = localizedName(order.branch, locale);
      const createdAt = new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'uz-UZ', {
        dateStyle: 'medium',
      }).format(new Date(order.created_at));

      return [
        `<b>${index + 1}. ${escapeHtml(category)}</b>`,
        `${locale === 'ru' ? 'Статус' : 'Holat'}: ${escapeHtml(status)}`,
        `${locale === 'ru' ? 'Филиал' : 'Filial'}: ${escapeHtml(branch)}`,
        `${locale === 'ru' ? 'Дата' : 'Sana'}: ${createdAt}`,
      ].join('\n');
    })
    .join('\n\n');

export const formatCategoryPage = (
  categories: PhoneCategory[],
  page: number,
  locale: Locale,
  pageSize = 10,
): string => {
  const start = page * pageSize;
  return categories
    .slice(start, start + pageSize)
    .map((category, index) => `${start + index + 1}. ${localizedCatalogName(category, locale)}`)
    .join('\n');
};

export const formatProblemList = (problems: ProblemCategory[], locale: Locale): string =>
  problems
    .map(
      (problem, index) =>
        `${index + 1}. ${localizedCatalogName(problem, locale)} (${problem.cost})`,
    )
    .join('\n');

export const formatRepairRequestSummary = (
  unknownClient: UnknownClientSession,
  draft: RepairRequestDraft,
  locale: Locale,
): string => {
  const labels =
    locale === 'ru'
      ? {
          name: 'Имя',
          phone: 'Телефон',
          os: 'ОС',
          model: 'Модель',
          problems: 'Неисправности',
          note: 'Примечание',
          none: 'Не указано',
        }
      : {
          name: 'Ism',
          phone: 'Telefon',
          os: 'OT',
          model: 'Model',
          problems: 'Muammolar',
          note: 'Izoh',
          none: 'Ko‘rsatilmagan',
        };
  const fullName = [unknownClient.firstName, unknownClient.lastName].filter(Boolean).join(' ');
  const selectedProblems = draft.problems
    .filter((problem) => draft.selectedProblemIds.includes(problem.id))
    .map((problem) => localizedCatalogName(problem, locale))
    .join(', ');
  const modelPath = [...draft.categoryPath, draft.selectedCategory]
    .filter((item): item is PhoneCategory => Boolean(item))
    .map((item) => localizedCatalogName(item, locale))
    .join(' → ');

  return [
    `<b>${labels.name}:</b> ${escapeHtml(fullName)}`,
    `<b>${labels.phone}:</b> ${escapeHtml(unknownClient.phoneNumber)}`,
    `<b>${labels.os}:</b> ${escapeHtml(
      draft.selectedOs ? localizedCatalogName(draft.selectedOs, locale) : labels.none,
    )}`,
    `<b>${labels.model}:</b> ${escapeHtml(modelPath || labels.none)}`,
    `<b>${labels.problems}:</b> ${escapeHtml(selectedProblems || labels.none)}`,
    `<b>${labels.note}:</b> ${escapeHtml(draft.note || labels.none)}`,
  ].join('\n');
};

export const buildRepairDescription = (draft: RepairRequestDraft, locale: Locale): string => {
  const selectedProblems = draft.problems
    .filter((problem) => draft.selectedProblemIds.includes(problem.id))
    .map((problem) => localizedCatalogName(problem, locale));
  const lines: string[] = [];
  if (selectedProblems.length > 0) {
    lines.push(
      `${locale === 'ru' ? 'Неисправности' : 'Muammolar'}: ${selectedProblems.join(', ')}`,
    );
  }
  if (draft.note) {
    lines.push(`${locale === 'ru' ? 'Примечание' : 'Izoh'}: ${draft.note}`);
  }
  return lines.join('\n');
};
