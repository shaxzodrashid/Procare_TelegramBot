import { InlineKeyboard, Keyboard } from 'grammy';

import type { AdminProfile, ClientProfile, Locale } from '../types/client.js';
import type { MessageTemplate } from '../types/message-template.js';
import type { OsType, ProblemCategory } from '../types/repair-order.js';
import { localizedCatalogName } from '../types/repair-order.js';
import { t } from './messages.js';

export const languageKeyboard = (): Keyboard =>
  new Keyboard().text(t('uz', 'uzbek')).text(t('ru', 'russian')).resized().oneTime();

export const registrationKeyboard = (locale: Locale): Keyboard =>
  new Keyboard().requestContact(t(locale, 'sharePhone')).resized().oneTime();

export interface PersonalMenuUser {
  locale: Locale;
  client?: Pick<ClientProfile, 'account_type'> | null;
  admin?: Pick<AdminProfile, 'id'> | null;
}

const clientMenuKeyboard = (locale: Locale): Keyboard =>
  new Keyboard().text(t(locale, 'orders')).row().text(t(locale, 'settings')).resized();

const employeeMenuKeyboard = (locale: Locale): Keyboard =>
  new Keyboard().text(t(locale, 'adminTemplates')).row().text(t(locale, 'settings')).resized();

export const personalMenuKeyboard = (user: PersonalMenuUser): Keyboard => {
  if (user.client) return clientMenuKeyboard(user.locale);
  if (user.admin) return employeeMenuKeyboard(user.locale);
  return languageKeyboard();
};

export const settingsKeyboard = (locale: Locale): Keyboard =>
  new Keyboard()
    .text(t(locale, 'settingsName'))
    .text(t(locale, 'settingsPhone'))
    .row()
    .text(t(locale, 'settingsLanguage'))
    .row()
    .text(t(locale, 'settingsBack'))
    .resized();

export const settingsBackKeyboard = (locale: Locale): Keyboard =>
  new Keyboard().text(t(locale, 'settingsBack')).resized().oneTime();

export const settingsPhoneKeyboard = (locale: Locale): Keyboard =>
  new Keyboard()
    .requestContact(t(locale, 'sharePhone'))
    .row()
    .text(t(locale, 'settingsBack'))
    .resized()
    .oneTime();

export const settingsLanguageKeyboard = (locale: Locale): Keyboard =>
  new Keyboard()
    .text(t('uz', 'uzbek'))
    .text(t('ru', 'russian'))
    .row()
    .text(t(locale, 'settingsBack'))
    .resized()
    .oneTime();

export const requestOfferKeyboard = (locale: Locale): InlineKeyboard =>
  new InlineKeyboard()
    .text(t(locale, 'leaveRequest'), 'request:accept')
    .row()
    .text(t(locale, 'declineRequest'), 'request:decline');

export const osTypesKeyboard = (items: OsType[], locale: Locale): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  items.forEach((item, index) => {
    keyboard.text(localizedCatalogName(item, locale), `os:${index}`).row();
  });
  return keyboard;
};

export const categoryKeyboard = (
  totalItems: number,
  page: number,
  locale: Locale,
  pageSize = 10,
): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  const start = page * pageSize;
  const end = Math.min(start + pageSize, totalItems);
  for (let index = start; index < end; index += 1) {
    keyboard.text(String(index + 1), `category:${index}`);
    if ((index - start + 1) % 5 === 0) keyboard.row();
  }
  keyboard.row();

  if (page > 0) keyboard.text('‹', `category-page:${page - 1}`);
  if (end < totalItems) keyboard.text('›', `category-page:${page + 1}`);
  keyboard.row().text(t(locale, 'back'), 'category:back');
  return keyboard;
};

export const problemsKeyboard = (
  problems: ProblemCategory[],
  selectedIds: string[],
  locale: Locale,
): InlineKeyboard => {
  const selected = new Set(selectedIds);
  const keyboard = new InlineKeyboard();
  problems.forEach((problem, index) => {
    keyboard.text(`${selected.has(problem.id) ? '☑' : '☐'} ${index + 1}`, `problem:${index}`);
    if ((index + 1) % 4 === 0) keyboard.row();
  });
  keyboard
    .row()
    .text(t(locale, 'back'), 'problem:back')
    .text(t(locale, 'continue'), 'problem:done');
  return keyboard;
};

export const noteKeyboard = (locale: Locale): Keyboard =>
  new Keyboard().text(t(locale, 'skipNote')).resized().oneTime();

export const confirmationKeyboard = (locale: Locale): InlineKeyboard =>
  new InlineKeyboard()
    .text(t(locale, 'confirm'), 'confirm:yes')
    .text(t(locale, 'cancel'), 'confirm:no');

export const repairOrdersKeyboard = (
  orderNumbers: string[],
  pagination: { limit: number; offset: number; has_more: boolean },
  locale: Locale,
): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  orderNumbers.forEach((orderNumber, index) => {
    keyboard.text(`🧾 #${orderNumber}`, `ro:v:${pagination.offset}:${index}`).row();
  });

  if (pagination.offset > 0) {
    keyboard.text('‹', `ro:p:${Math.max(0, pagination.offset - pagination.limit)}`);
  }
  if (pagination.has_more) {
    keyboard.text('›', `ro:p:${pagination.offset + pagination.limit}`);
  }
  keyboard.row().text(t(locale, 'ordersRefresh'), `ro:p:${pagination.offset}`);
  return keyboard;
};

export const repairOrderDetailKeyboard = (
  locale: Locale,
  options: { mapUrl?: string | null } = {},
): InlineKeyboard => {
  const keyboard = new InlineKeyboard()
    .text(t(locale, 'orderRefresh'), 'ro:r')
    .text(t(locale, 'ordersBack'), 'ro:b');
  if (options.mapUrl) keyboard.row().url(t(locale, 'orderMap'), options.mapUrl);
  return keyboard;
};

export const adminTemplateListKeyboard = (
  templates: Pick<MessageTemplate, 'id' | 'title' | 'is_active'>[],
  locale: Locale,
): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  templates.forEach((template) => {
    const status = template.is_active ? '●' : '○';
    const title =
      template.title.length > 34 ? `${template.title.slice(0, 31).trimEnd()}...` : template.title;
    keyboard.text(`${status} ${title}`, `tmpl:v:${template.id}`).row();
  });
  keyboard.text(t(locale, 'adminTemplateCreate'), 'tmpl:c');
  return keyboard;
};

export const adminTemplateDetailKeyboard = (
  template: Pick<MessageTemplate, 'id' | 'is_active'>,
  locale: Locale,
): InlineKeyboard =>
  new InlineKeyboard()
    .text(t(locale, 'adminTemplateEditKey'), `tmpl:e:${template.id}:k`)
    .text(t(locale, 'adminTemplateEditType'), `tmpl:e:${template.id}:tp`)
    .row()
    .text(t(locale, 'adminTemplateEditTitle'), `tmpl:e:${template.id}:ti`)
    .row()
    .text(t(locale, 'adminTemplateEditUz'), `tmpl:e:${template.id}:uz`)
    .text(t(locale, 'adminTemplateEditRu'), `tmpl:e:${template.id}:ru`)
    .row()
    .text(
      t(locale, template.is_active ? 'adminTemplateDeactivate' : 'adminTemplateActivate'),
      `tmpl:t:${template.id}`,
    )
    .row()
    .text(t(locale, 'adminTemplateDelete'), `tmpl:d:${template.id}`)
    .row()
    .text(t(locale, 'adminTemplateBack'), 'tmpl:l');

export const adminTemplateCancelKeyboard = (locale: Locale): Keyboard =>
  new Keyboard().text(t(locale, 'adminTemplateCancel')).resized().oneTime();
