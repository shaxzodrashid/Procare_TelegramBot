import { InlineKeyboard, Keyboard } from 'grammy';

import type { AdminProfile, ClientProfile, Locale } from '../types/client.js';
import { MESSAGE_TEMPLATE_TYPES, type MessageTemplate } from '../types/message-template.js';
import type { UserRegistrationState } from '../types/registered-user.js';
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
  admin?: Pick<AdminProfile, 'id' | 'is_active'> | null;
}

const clientMenuKeyboard = (locale: Locale): Keyboard =>
  new Keyboard().text(t(locale, 'orders')).row().text(t(locale, 'settings')).resized();

const employeeMenuKeyboard = (locale: Locale): Keyboard =>
  new Keyboard()
    .text(t(locale, 'adminClients'))
    .text(t(locale, 'adminTemplates'))
    .row()
    .text(t(locale, 'adminExport'))
    .row()
    .text(t(locale, 'settings'))
    .resized();

export const personalMenuKeyboard = (user: PersonalMenuUser): Keyboard => {
  if (user.admin?.is_active) return employeeMenuKeyboard(user.locale);
  if (user.client) return clientMenuKeyboard(user.locale);
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
  options: {
    supportEnabled?: boolean;
    mapUrl?: string | null;
    checklistUrl?: string | null;
    warrantyDocumentUrl?: string | null;
    offerUrl?: string | null;
  } = {},
): InlineKeyboard => {
  const keyboard = new InlineKeyboard()
    .text(t(locale, 'orderRefresh'), 'ro:r')
    .text(t(locale, 'ordersBack'), 'ro:b');
  if (options.supportEnabled) keyboard.row().text(t(locale, 'orderSupport'), 'ro:s');

  const externalActions = [
    options.mapUrl ? { text: t(locale, 'orderMap'), url: options.mapUrl } : null,
    options.checklistUrl ? { text: t(locale, 'orderChecklist'), url: options.checklistUrl } : null,
    options.warrantyDocumentUrl
      ? { text: t(locale, 'orderWarrantyDocument'), url: options.warrantyDocumentUrl }
      : null,
    options.offerUrl ? { text: t(locale, 'orderOffer'), url: options.offerUrl } : null,
  ].filter((action): action is { text: string; url: string } => action !== null);

  externalActions.forEach((action, index) => {
    if (index % 2 === 0) keyboard.row();
    keyboard.url(action.text, action.url);
  });

  return keyboard;
};

export const supportCommentKeyboard = (locale: Locale): Keyboard =>
  new Keyboard().text(t(locale, 'supportCancel')).resized().oneTime();

export const adminTemplateListKeyboard = (
  templates: Pick<MessageTemplate, 'id' | 'title' | 'is_active'>[],
  locale: Locale,
): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  templates.forEach((template) => {
    const status = template.is_active ? '🟢' : '⚫';
    const title =
      template.title.length > 34 ? `${template.title.slice(0, 31).trimEnd()}...` : template.title;
    keyboard.text(`${status} ${title}`, `atpd:${template.id}`).row();
  });
  keyboard
    .text(t(locale, 'adminTemplateCreate'), 'admin_template_create')
    .row()
    .text(t(locale, 'adminTemplateBackToMenu'), 'admin:menu');
  return keyboard;
};

export const adminTemplateDetailKeyboard = (
  template: Pick<MessageTemplate, 'id' | 'is_active'>,
  locale: Locale,
): InlineKeyboard =>
  new InlineKeyboard()
    .text(t(locale, 'adminTemplateEditKey'), `ate:${template.id}:template_key`)
    .text(t(locale, 'adminTemplateEditType'), `ate:${template.id}:template_type`)
    .row()
    .text(t(locale, 'adminTemplateEditTitle'), `ate:${template.id}:title`)
    .row()
    .text(t(locale, 'adminTemplateEditUz'), `ate:${template.id}:content_uz`)
    .text(t(locale, 'adminTemplateEditRu'), `ate:${template.id}:content_ru`)
    .row()
    .text(
      t(locale, template.is_active ? 'adminTemplateDeactivate' : 'adminTemplateActivate'),
      `att:${template.id}`,
    )
    .row()
    .text(t(locale, 'adminTemplateDelete'), `atdl:${template.id}`)
    .row()
    .text(t(locale, 'adminTemplateBack'), 'admin_templates_back');

export const adminTemplateCancelKeyboard = (locale: Locale): Keyboard =>
  new Keyboard().text(t(locale, 'adminTemplateCancel')).resized().oneTime();

export const adminTemplateTypeKeyboard = (locale: Locale): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  MESSAGE_TEMPLATE_TYPES.forEach((type, index) => {
    keyboard.text(type, `atts:${type}`);
    if (index % 2 === 1) keyboard.row();
  });
  keyboard.row().text(t(locale, 'adminTemplateCancel'), 'atts:cancel');
  return keyboard;
};

export const adminClientResultsKeyboard = (
  clients: UserRegistrationState[],
  locale: Locale,
): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  clients.forEach((client) => {
    const fullName = `${client.user.first_name}${client.user.last_name ? ` ${client.user.last_name}` : ''}`;
    const label = `${fullName} (${client.user.phone_number})`;
    keyboard.text(label, `ac:v:${client.user.telegram_id}`).row();
  });
  keyboard.text(t(locale, 'adminClientBack'), 'ac:search');
  return keyboard;
};

export const adminClientCardKeyboard = (telegramId: string, locale: Locale): InlineKeyboard =>
  new InlineKeyboard()
    .text(t(locale, 'adminClientSendCustom'), `ac:msg:${telegramId}`)
    .text(t(locale, 'adminClientSendTemplate'), `ac:tmpl:${telegramId}`)
    .row()
    .text(t(locale, 'adminClientBack'), 'ac:search');

export const adminClientCustomConfirmKeyboard = (
  telegramId: string,
  locale: Locale,
): InlineKeyboard =>
  new InlineKeyboard()
    .text(t(locale, 'adminClientSendConfirm'), `ac:custom_send:${telegramId}`)
    .text(t(locale, 'adminClientSendCancel'), 'ac:cancel');

export const adminClientTemplateConfirmKeyboard = (
  telegramId: string,
  templateId: string,
  locale: Locale,
): InlineKeyboard =>
  new InlineKeyboard()
    .text(t(locale, 'adminClientSendConfirm'), `ac:tmpl_send:${telegramId}:${templateId}`)
    .text(t(locale, 'adminClientSendCancel'), 'ac:cancel');

export const adminClientTemplateListKeyboard = (
  templates: Pick<MessageTemplate, 'id' | 'title' | 'is_active'>[],
  telegramId: string,
  locale: Locale,
): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  templates.forEach((template) => {
    const title =
      template.title.length > 34 ? `${template.title.slice(0, 31).trimEnd()}...` : template.title;
    keyboard.text(title, `ac:tmpl_sel:${telegramId}:${template.id}`).row();
  });
  keyboard.text(t(locale, 'adminClientBack'), `ac:v:${telegramId}`);
  return keyboard;
};

export const adminClientCancelKeyboard = (locale: Locale): Keyboard =>
  new Keyboard().text(t(locale, 'adminClientCancel')).resized().oneTime();

export const adminExportCancelKeyboard = (locale: Locale): Keyboard =>
  new Keyboard().text(t(locale, 'adminExportCancel')).resized().oneTime();
