import { InlineKeyboard, Keyboard } from 'grammy';

import type { AdminProfile, ClientProfile, Locale } from '../types/client.js';
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
  new Keyboard().text(t(locale, 'orders')).row().text(t(locale, 'language')).resized();

const employeeMenuKeyboard = (locale: Locale): Keyboard =>
  new Keyboard().text(t(locale, 'language')).resized();

export const personalMenuKeyboard = (user: PersonalMenuUser): Keyboard => {
  if (user.client) return clientMenuKeyboard(user.locale);
  if (user.admin) return employeeMenuKeyboard(user.locale);
  return languageKeyboard();
};

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
