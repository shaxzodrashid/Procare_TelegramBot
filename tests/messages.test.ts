import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { t } from '../src/bot/messages.js';

describe('localized bot messages', () => {
  it('does not expose role wording to registered clients', () => {
    assert.equal(
      t('uz', 'registered', { name: 'Shaxzod' }),
      '✨ <b>PROCARE CLIENT PORTAL</b> ✨\n\n👋 Assalomu alaykum, <b>Shaxzod</b>!\nProcare xizmatlaridan foydalanayotganingizdan mamnunmiz.\n\n📋 <b>Menyu orqali quyidagi amallarni bajarishingiz mumkin:</b>\n ├ 📦 <b>Mening buyurtmalarim</b> — faol va yakunlangan buyurtmalar holatini ko‘rish\n ├ ✍️ <b>Ariza qoldirish</b> — yangi ta’mirlash uchun tezkor ariza yuborish\n └ ⚙️ <b>Sozlamalar</b> — profilingiz ma’lumotlarini yangilash\n\n👇 Kerakli bo‘limni tanlang:',
    );
    assert.equal(
      t('ru', 'registered', { name: 'Шахзод' }),
      '✨ <b>PROCARE CLIENT PORTAL</b> ✨\n\n👋 Здравствуйте, <b>Шахзод</b>!\nМы рады, что вы пользуетесь услугами нашего сервиса.\n\n📋 <b>Через меню вы можете выполнить следующие действия:</b>\n ├ 📦 <b>Мои заказы</b> — просмотр статуса активных и завершенных заказов\n ├ ✍️ <b>Оставить заявку</b> — быстрая отправка новой заявки на ремонт\n └ ⚙️ <b>Настройки</b> — редактирование информации вашего профиля\n\n👇 Выберите нужный раздел:',
    );
    assert.equal(
      t('uz', 'clientHelp'),
      '✨ <b>PROCARE CLIENT PORTAL</b> ✨\n\n📋 <b>Menyu orqali quyidagi amallarni bajarishingiz mumkin:</b>\n ├ 📦 <b>Mening buyurtmalarim</b> — faol va yakunlangan buyurtmalar holatini ko‘rish\n ├ ✍️ <b>Ariza qoldirish</b> — yangi ta’mirlash uchun tezkor ariza yuborish\n └ ⚙️ <b>Sozlamalar</b> — profilingiz ma’lumotlarini yangilash\n\n👇 Kerakli bo‘limni tanlang:',
    );
    assert.equal(
      t('ru', 'clientHelp'),
      '✨ <b>PROCARE CLIENT PORTAL</b> ✨\n\n📋 <b>Через меню вы можете выполнить следующие действия:</b>\n ├ 📦 <b>Мои заказы</b> — просмотр статуса активных и завершенных заказов\n ├ ✍️ <b>Оставить заявку</b> — быстрая отправка новой заявки на ремонт\n └ ⚙️ <b>Настройки</b> — редактирование информации вашего профиля\n\n👇 Выберите нужный раздел:',
    );
  });
});
