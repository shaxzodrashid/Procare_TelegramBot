import type { Locale } from '../types/client.js';

const messages = {
  uz: {
    chooseLanguage: 'Tilni tanlang / Выберите язык:',
    welcome:
      'Assalomu alaykum! Procare botiga xush kelibsiz.\n\nDavom etish uchun o‘zingizga tegishli telefon raqamini ulashing.',
    sharePhone: 'Raqamimni ulashish',
    phoneOnly: 'Iltimos, tugma orqali o‘zingizning telefon raqamingizni ulashing.',
    registering: 'Ma’lumotlaringiz tekshirilmoqda...',
    registered: 'Xush kelibsiz, {{name}}! Profilingiz muvaffaqiyatli topildi.',
    notFound:
      'Bu raqam bo‘yicha faol mijoz topilmadi. Ta’mirlash uchun yangi ariza qoldirmoqchimisiz?',
    leaveRequest: 'Ariza qoldirish',
    declineRequest: 'Yo‘q, rahmat',
    requestDeclined: 'Ma’lumotlaringiz saqlandi. Keyinroq /start orqali qayta urinishingiz mumkin.',
    chooseOs: 'Telefoningiz operatsion tizimini tanlang:',
    noOsTypes: 'Hozircha telefon turlari mavjud emas. Iltimos, keyinroq urinib ko‘ring.',
    chooseCategory: 'Telefon modelini tanlang:',
    noCategories: 'Bu bo‘limda telefon modellari topilmadi.',
    chooseProblems:
      'Muammolarni belgilang. Bir nechta variantni tanlashingiz mumkin, so‘ng “Davom etish”ni bosing:',
    continue: 'Davom etish',
    back: 'Orqaga',
    enterNote: 'Ariza uchun qo‘shimcha izoh yozing. Izoh bo‘lmasa, “Izohsiz davom etish”ni bosing.',
    skipNote: 'Izohsiz davom etish',
    noteTooLong: 'Izoh 9000 belgidan oshmasligi kerak. Qisqaroq izoh yuboring.',
    confirmRequest: 'Ariza ma’lumotlarini tekshiring:',
    confirm: 'Tasdiqlash',
    cancel: 'Bekor qilish',
    submittingRequest: 'Ariza yuborilmoqda...',
    requestCreated: 'Arizangiz qabul qilindi. Ariza raqami: {{number}}.',
    requestCancelled: 'Ariza bekor qilindi va ma’lumotlaringiz saqlandi.',
    requestUnavailable: 'Arizani hozir yuborib bo‘lmadi. Iltimos, keyinroq urinib ko‘ring.',
    requestRateLimited: 'Juda ko‘p urinish bo‘ldi. Bir ozdan keyin qayta urinib ko‘ring.',
    staleAction: 'Bu tugma eskirgan. /start orqali jarayonni qayta boshlang.',
    emptyProblems: 'Ushbu model uchun tayyor muammolar ro‘yxati yo‘q. Izoh yozishingiz mumkin.',
    invalidPhone: 'Telefon raqami noto‘g‘ri. O‘zbekiston raqamini qayta ulashing.',
    maintenance: 'Texnik ishlar ketmoqda. Iltimos, keyinroq urinib ko‘ring.',
    unavailable: 'Xizmat vaqtincha ishlamayapti. Iltimos, keyinroq urinib ko‘ring.',
    orders: 'Ta’mirlash buyurtmalarim',
    noOrders: 'Sizda hozircha ta’mirlash buyurtmalari yo‘q.',
    registerFirst: 'Avval /start buyrug‘i orqali telefon raqamingizni ulang.',
    help: 'Yordam uchun telefon raqamingizni ulang yoki /start buyrug‘ini yuboring.',
    language: 'Русский',
    uzbek: 'O‘zbekcha',
    russian: 'Русский',
  },
  ru: {
    chooseLanguage: 'Tilni tanlang / Выберите язык:',
    welcome:
      'Здравствуйте! Добро пожаловать в бот Procare.\n\nЧтобы продолжить, поделитесь своим номером телефона.',
    sharePhone: 'Поделиться моим номером',
    phoneOnly: 'Пожалуйста, отправьте свой номер телефона с помощью кнопки.',
    registering: 'Проверяем ваши данные...',
    registered: 'Добро пожаловать, {{name}}! Ваш профиль найден.',
    notFound: 'Активный клиент с таким номером не найден. Хотите оставить новую заявку на ремонт?',
    leaveRequest: 'Оставить заявку',
    declineRequest: 'Нет, спасибо',
    requestDeclined:
      'Ваши данные сохранены. Вы можете начать заново позже с помощью команды /start.',
    chooseOs: 'Выберите операционную систему телефона:',
    noOsTypes: 'Типы телефонов пока недоступны. Попробуйте позже.',
    chooseCategory: 'Выберите модель телефона:',
    noCategories: 'В этом разделе модели телефонов не найдены.',
    chooseProblems:
      'Отметьте неисправности. Можно выбрать несколько вариантов, затем нажмите «Продолжить»:',
    continue: 'Продолжить',
    back: 'Назад',
    enterNote:
      'Напишите дополнительное примечание к заявке. Если примечания нет, нажмите «Продолжить без примечания».',
    skipNote: 'Продолжить без примечания',
    noteTooLong: 'Примечание не должно превышать 9000 символов. Отправьте более короткий текст.',
    confirmRequest: 'Проверьте данные заявки:',
    confirm: 'Подтвердить',
    cancel: 'Отменить',
    submittingRequest: 'Отправляем заявку...',
    requestCreated: 'Ваша заявка принята. Номер заявки: {{number}}.',
    requestCancelled: 'Заявка отменена, ваши данные сохранены.',
    requestUnavailable: 'Сейчас не удалось отправить заявку. Попробуйте позже.',
    requestRateLimited: 'Слишком много попыток. Повторите немного позже.',
    staleAction: 'Эта кнопка устарела. Начните заново с помощью /start.',
    emptyProblems:
      'Для этой модели нет готового списка неисправностей. Вы можете описать проблему в примечании.',
    invalidPhone: 'Неверный номер. Пожалуйста, отправьте номер Узбекистана повторно.',
    maintenance: 'Ведутся технические работы. Попробуйте позже.',
    unavailable: 'Сервис временно недоступен. Попробуйте позже.',
    orders: 'Мои заказы на ремонт',
    noOrders: 'У вас пока нет заказов на ремонт.',
    registerFirst: 'Сначала отправьте номер телефона через команду /start.',
    help: 'Для продолжения поделитесь номером телефона или отправьте команду /start.',
    language: 'O‘zbekcha',
    uzbek: 'O‘zbekcha',
    russian: 'Русский',
  },
} as const;

export type MessageKey = keyof (typeof messages)['uz'];

export const t = (
  locale: Locale,
  key: MessageKey,
  variables: Record<string, string> = {},
): string => {
  let text: string = messages[locale][key];
  for (const [name, value] of Object.entries(variables)) {
    text = text.replaceAll(`{{${name}}}`, value);
  }
  return text;
};
