import type {
  CustomerRepairOrderDetail,
  CustomerRepairOrderList,
  CustomerRepairOrderListItem,
  LocalizedCustomerSummary,
  LocalizedCustomerText,
} from '../types/client-repair-order.js';
import type { Locale } from '../types/client.js';
import type { PhoneCategory, ProblemCategory } from '../types/repair-order.js';
import { localizedCatalogName } from '../types/repair-order.js';
import { escapeHtml } from '../utils/html.js';
import type { RepairRequestDraft, UnknownClientSession } from './context.js';
import type { SmartReplyContent } from './rich-messages.js';

const localizedCustomerText = (
  value: LocalizedCustomerText | null,
  locale: Locale,
  fallback = '—',
): string => value?.[locale === 'ru' ? 'name_ru' : 'name_uz'] ?? value?.name_en ?? fallback;

const localizedCustomerSummary = (
  value: LocalizedCustomerSummary,
  locale: Locale,
  fallback = '—',
): string => value[locale === 'ru' ? 'ru' : 'uz'] ?? value.en ?? fallback;

const localizedStatusName = (
  status: CustomerRepairOrderListItem['status'],
  locale: Locale,
): string => localizedCustomerText(status, locale, status.code);

const formatDate = (value: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'uz-UZ', {
    dateStyle: 'medium',
  }).format(new Date(value));

const formatDateTime = (value: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'uz-UZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tashkent',
  }).format(new Date(value));

const formatMoney = (value: string | null, currency: string, locale: Locale): string => {
  if (value === null) return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return `${value} ${currency}`;
  try {
    return new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'uz-UZ', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${value} ${currency}`;
  }
};

const statusIcon = (code: CustomerRepairOrderListItem['status']['code']): string => {
  if (code === 'COMPLETED') return '✅';
  if (code === 'READY') return '🟢';
  if (code === 'CANCELLED' || code === 'INVALID' || code === 'UNREPAIRABLE') return '🔴';
  if (code === 'MISSED' || code === 'WAITING_FOR_PARTS' || code === 'AWAITING_APPROVAL')
    return '🟠';
  return '🔵';
};

const deviceName = (order: CustomerRepairOrderListItem): string =>
  [order.device.brand, order.device.model].filter(Boolean).join(' ') || `#${order.order_number}`;

const progressBar = (step: number, totalSteps: number): string => {
  const width = 7;
  const completed = Math.max(1, Math.min(width, Math.round((step / totalSteps) * width)));
  return `${'●'.repeat(completed)}${'○'.repeat(width - completed)} ${step}/${totalSteps}`;
};

export const formatClientRepairOrderList = (
  result: CustomerRepairOrderList,
  locale: Locale,
): SmartReplyContent => {
  const labels =
    locale === 'ru'
      ? {
          title: 'Мои заказы',
          order: 'Заказ',
          accepted: 'Принят',
          ready: 'Ориентировочно готов',
          total: 'Сумма',
          page: 'Показано',
        }
      : {
          title: 'Buyurtmalarim',
          order: 'Buyurtma',
          accepted: 'Qabul qilindi',
          ready: 'Taxminiy tayyor',
          total: 'Jami',
          page: 'Ko‘rsatildi',
        };

  const fallbackCards = result.orders.map((order, index) => {
    const status = localizedStatusName(order.status, locale);
    return [
      `<b>${index + 1}. ${escapeHtml(deviceName(order))}</b>`,
      `${statusIcon(order.status.code)} <b>${escapeHtml(status)}</b>`,
      `🧾 ${labels.order}: <code>#${escapeHtml(order.order_number)}</code>`,
      `📅 ${labels.accepted}: ${formatDate(order.created_at, locale)}`,
      order.estimated_ready_at
        ? `⏱ ${labels.ready}: ${formatDate(order.estimated_ready_at, locale)}`
        : null,
      order.pricing.final_total
        ? `💰 ${labels.total}: ${escapeHtml(
            formatMoney(order.pricing.final_total, order.pricing.currency, locale),
          )}`
        : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');
  });

  const richCards = result.orders.map((order, index) => {
    const status = localizedStatusName(order.status, locale);
    const progress =
      order.status.progress_type === 'linear' &&
      order.status.step !== null &&
      order.status.total_steps !== null
        ? `<p>${escapeHtml(progressBar(order.status.step, order.status.total_steps))}</p>`
        : '';
    return `<h2>${index + 1}. ${escapeHtml(deviceName(order))}</h2>
<p>${statusIcon(order.status.code)} <b>${escapeHtml(status)}</b><br/>
🧾 ${labels.order}: <code>#${escapeHtml(order.order_number)}</code><br/>
📅 ${labels.accepted}: ${formatDate(order.created_at, locale)}${
      order.estimated_ready_at
        ? `<br/>⏱ ${labels.ready}: ${formatDate(order.estimated_ready_at, locale)}`
        : ''
    }${
      order.pricing.final_total
        ? `<br/>💰 ${labels.total}: ${escapeHtml(
            formatMoney(order.pricing.final_total, order.pricing.currency, locale),
          )}`
        : ''
    }</p>${progress}`;
  });

  const rangeStart = result.pagination.total === 0 ? 0 : result.pagination.offset + 1;
  const rangeEnd = result.pagination.offset + result.orders.length;
  const footer = `${labels.page}: ${rangeStart}–${rangeEnd} / ${result.pagination.total}`;

  return {
    richHtml: `<h1>🧾 ${labels.title}</h1>${richCards.join('<hr/>')}<footer>${footer}</footer>`,
    fallbackHtml: `<b>🧾 ${labels.title}</b>\n\n${fallbackCards.join('\n\n')}\n\n<i>${footer}</i>`,
  };
};

export const formatClientRepairOrderDetail = (
  order: CustomerRepairOrderDetail,
  locale: Locale,
): SmartReplyContent => {
  const labels =
    locale === 'ru'
      ? {
          order: 'Заказ',
          status: 'Статус',
          accepted: 'Принят',
          updated: 'Обновлён',
          estimatedReady: 'Ориентировочно готов',
          problem: 'Неисправность',
          service: 'Работы',
          payment: 'Оплата',
          estimated: 'Предварительно',
          total: 'Итого',
          paid: 'Оплачено',
          remaining: 'Остаток',
          branch: 'Филиал',
          address: 'Адрес',
          hours: 'Режим работы',
          imei: 'IMEI',
          warranty: 'Гарантия',
          months: 'мес.',
          until: 'до',
          completed: 'Завершён',
          pickedUp: 'Выдан',
          history: 'История статусов',
        }
      : {
          order: 'Buyurtma',
          status: 'Holat',
          accepted: 'Qabul qilindi',
          updated: 'Yangilandi',
          estimatedReady: 'Taxminiy tayyor',
          problem: 'Muammo',
          service: 'Bajariladigan ish',
          payment: 'To‘lov',
          estimated: 'Taxminiy',
          total: 'Jami',
          paid: 'To‘langan',
          remaining: 'Qoldiq',
          branch: 'Filial',
          address: 'Manzil',
          hours: 'Ish vaqti',
          imei: 'IMEI',
          warranty: 'Kafolat',
          months: 'oy',
          until: 'gacha',
          completed: 'Yakunlandi',
          pickedUp: 'Topshirildi',
          history: 'Holatlar tarixi',
        };

  const status = localizedStatusName(order.status, locale);
  const message =
    order.status[locale === 'ru' ? 'customer_message_ru' : 'customer_message_uz'] ??
    order.status.customer_message_en;
  const problem = localizedCustomerSummary(order.problem_summary, locale);
  const service = localizedCustomerSummary(order.service_summary, locale);
  const branch = localizedCustomerText(order.branch, locale);
  const branchAddress =
    order.branch?.[locale === 'ru' ? 'address_ru' : 'address_uz'] ??
    order.branch?.address_en ??
    null;
  const progress =
    order.status.progress_type === 'linear' &&
    order.status.step !== null &&
    order.status.total_steps !== null
      ? progressBar(order.status.step, order.status.total_steps)
      : null;
  const warranty = [
    order.warranty.period_months !== null
      ? `${order.warranty.period_months} ${labels.months}`
      : null,
    order.warranty.warranty_until
      ? `${labels.until} ${formatDate(order.warranty.warranty_until, locale)}`
      : null,
  ]
    .filter(Boolean)
    .join(', ');
  const workingHours = [order.branch.working_hours.start, order.branch.working_hours.end]
    .filter((value): value is string => Boolean(value))
    .join('–');

  const commonLines = [
    `${statusIcon(order.status.code)} <b>${escapeHtml(status)}</b>`,
    message ? escapeHtml(message) : null,
    progress ? `<code>${escapeHtml(progress)}</code>` : null,
    `📅 ${labels.accepted}: ${formatDate(order.created_at, locale)}`,
    `🔄 ${labels.updated}: ${formatDateTime(order.status.updated_at, locale)}`,
    order.estimated_ready_at
      ? `⏱ ${labels.estimatedReady}: ${formatDate(order.estimated_ready_at, locale)}`
      : null,
    order.device.imei_last4
      ? `🔐 ${labels.imei}: •••• ${escapeHtml(order.device.imei_last4)}`
      : null,
  ].filter((line): line is string => Boolean(line));

  const repairLines = [
    `${labels.problem}: ${escapeHtml(problem)}`,
    `${labels.service}: ${escapeHtml(service)}`,
    order.completed_at
      ? `${labels.completed}: ${formatDateTime(order.completed_at, locale)}`
      : null,
    order.picked_up_at ? `${labels.pickedUp}: ${formatDateTime(order.picked_up_at, locale)}` : null,
    warranty ? `${labels.warranty}: ${escapeHtml(warranty)}` : null,
  ].filter((line): line is string => Boolean(line));

  const pricingLines = [
    `${labels.estimated}: ${escapeHtml(
      formatMoney(order.pricing.estimated_total, order.pricing.currency, locale),
    )}`,
    `${labels.total}: ${escapeHtml(
      formatMoney(order.pricing.final_total, order.pricing.currency, locale),
    )}`,
    `${labels.paid}: ${escapeHtml(
      formatMoney(order.pricing.paid_amount, order.pricing.currency, locale),
    )}`,
    `${labels.remaining}: ${escapeHtml(
      formatMoney(order.pricing.remaining_amount, order.pricing.currency, locale),
    )}`,
  ];

  const branchLines = [
    escapeHtml(branch),
    branchAddress ? `${labels.address}: ${escapeHtml(branchAddress)}` : null,
    order.branch.telephone ? `☎️ ${escapeHtml(order.branch.telephone)}` : null,
    workingHours ? `${labels.hours}: ${escapeHtml(workingHours)}` : null,
  ].filter((line): line is string => Boolean(line));

  const historyLines = order.status_history.map((item) => {
    const historyName = localizedCustomerText(item, locale, item.code);
    return `• ${formatDateTime(item.changed_at, locale)} — ${escapeHtml(historyName)}`;
  });

  const fallbackSections = [
    `<b>${escapeHtml(deviceName(order))}</b>\n🧾 ${labels.order}: <code>#${escapeHtml(
      order.order_number,
    )}</code>`,
    commonLines.join('\n'),
    `<b>🛠 ${labels.service}</b>\n${repairLines.join('\n')}`,
    `<b>💳 ${labels.payment}</b>\n${pricingLines.join('\n')}`,
    branchLines.length > 0 ? `<b>📍 ${labels.branch}</b>\n${branchLines.join('\n')}` : null,
    historyLines.length > 0 ? `<b>🕘 ${labels.history}</b>\n${historyLines.join('\n')}` : null,
  ].filter((section): section is string => Boolean(section));

  const historyDetails =
    historyLines.length > 0
      ? `<details><summary>🕘 ${labels.history}</summary><p>${historyLines.join('<br/>')}</p></details>`
      : '';
  const branchSection =
    branchLines.length > 0 ? `<h2>📍 ${labels.branch}</h2><p>${branchLines.join('<br/>')}</p>` : '';

  return {
    richHtml: `<h1>${escapeHtml(deviceName(order))}</h1>
<p>🧾 ${labels.order}: <code>#${escapeHtml(order.order_number)}</code></p>
<h2>${statusIcon(order.status.code)} ${labels.status}</h2>
<p>${commonLines.join('<br/>')}</p>
<h2>🛠 ${labels.service}</h2><p>${repairLines.join('<br/>')}</p>
<h2>💳 ${labels.payment}</h2><p>${pricingLines.join('<br/>')}</p>
${branchSection}${historyDetails}`,
    fallbackHtml: fallbackSections.join('\n\n'),
  };
};

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
