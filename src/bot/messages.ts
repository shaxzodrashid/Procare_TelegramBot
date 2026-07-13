import type { Locale } from '../types/client.js';

const messages = {
  uz: {
    chooseLanguage: '🌐 Qulay tilni tanlang / Выберите удобный язык:',
    welcome:
      '✨ Assalomu alaykum! Procare servis yordamchisiga xush kelibsiz.\n\n📲 Buyurtmalaringiz va tezkor ta’mir arizasi uchun o‘zingizga tegishli telefon raqamini ulashing.',
    sharePhone: '📱 Raqamimni ulashish',
    phoneOnly:
      '📌 Iltimos, xavfsizlik uchun tugma orqali o‘zingizning telefon raqamingizni ulashing.',
    registering: '🔎 Ma’lumotlaringiz tekshirilmoqda...',
    registered:
      '✨ <b>PROCARE CLIENT PORTAL</b> ✨\n\n👋 Assalomu alaykum, <b>{{name}}</b>!\nProcare xizmatlaridan foydalanayotganingizdan mamnunmiz.\n\n📋 <b>Menyu orqali quyidagi amallarni bajarishingiz mumkin:</b>\n ├ 📦 <b>Mening buyurtmalarim</b> — faol va yakunlangan buyurtmalar holatini ko‘rish\n ├ ✍️ <b>Ariza qoldirish</b> — yangi ta’mirlash uchun tezkor ariza yuborish\n └ ⚙️ <b>Sozlamalar</b> — profilingiz ma’lumotlarini yangilash\n\n👇 Kerakli bo‘limni tanlang:',
    adminRegistered:
      '🛡️ <b>PROCARE WORKPLACE</b> 🛡️\n\n👋 Assalomu alaykum, <b>{{name}}</b>!\nSiz tizimga <b>Xodim</b> roli bilan kirdingiz.\n\n🛠️ <b>Ishchi vositalar:</b>\n ├ 🔍 <b>Mijozlar qidiruvi</b> — mijozlarni qidirish va xabarlar yuborish\n ├ 🧩 <b>Xabar shablonlari</b> — xabar shablonlarini boshqarish va yaratish\n ├ 🏷 <b>Status nomlari</b> — buyurtma statuslarining mijozga ko‘rinadigan nomlarini tahrirlash\n ├ 📤 <b>Excel eksport</b> — hisobotlarni Excel formatida yuklab olish\n └ ⚙️ <b>Sozlamalar</b> — shaxsiy ma’lumotlarni tahrirlash\n\n👇 Boshlash uchun bo‘limni tanlang:',
    notFound:
      '🔎 Bu raqam bo‘yicha faol mijoz topilmadi. Yangi ta’mir arizasini hoziroq qoldiramizmi?',
    leaveRequest: '🛠 Ariza qoldirish',
    declineRequest: '⏳ Keyinroq',
    requestDeclined:
      '✅ Ma’lumotlaringiz saqlandi. Tayyor bo‘lsangiz, /start orqali qayta boshlashingiz mumkin.',
    chooseOs: '📱 Telefoningiz operatsion tizimini tanlang:',
    noOsTypes: '🕓 Hozircha telefon turlari mavjud emas. Iltimos, keyinroq urinib ko‘ring.',
    chooseCategory: '📲 Telefon modelini tanlang:',
    noCategories: '📭 Bu bo‘limda telefon modellari topilmadi.',
    chooseProblems:
      '🧰 Muammolarni belgilang. Bir nechta variantni tanlashingiz mumkin, so‘ng “➡️ Davom etish”ni bosing:',
    continue: '➡️ Davom etish',
    back: '⬅️ Orqaga',
    enterNote:
      '✍️ Ariza uchun qo‘shimcha izoh yozing. Izoh bo‘lmasa, “⏭ Izohsiz davom etish”ni bosing.',
    skipNote: '⏭ Izohsiz davom etish',
    noteTooLong: '⚠️ Izoh 9000 belgidan oshmasligi kerak. Qisqaroq izoh yuboring.',
    confirmRequest: '📋 Ariza ma’lumotlarini tekshiring:',
    confirm: '✅ Tasdiqlash',
    cancel: '✖️ Bekor qilish',
    submittingRequest: '🚀 Ariza yuborilmoqda...',
    requestCreated: '🎉 Arizangiz qabul qilindi. Ariza raqami: {{number}}.',
    requestCancelled: '✅ Ariza bekor qilindi va ma’lumotlaringiz saqlandi.',
    requestUnavailable: '⚠️ Arizani hozir yuborib bo‘lmadi. Iltimos, keyinroq urinib ko‘ring.',
    requestRateLimited: '⏱ Juda ko‘p urinish bo‘ldi. Bir ozdan keyin qayta urinib ko‘ring.',
    requestDuplicate:
      '⚠️ Ushbu telefon raqami va model bo‘yicha faol ariza allaqachon mavjud. Avvalgi arizangiz ko‘rib chiqilishini kuting.',
    leaveRequestMenu: '✍️ Ariza qoldirish',
    leaveRequestIntro: '🛠 Yangi ta‘mir arizasi. Telefoningizning turini tanlang:',
    modelNotListed: 'Model ro‘yxatda yo‘q',
    enterCustomModel: 'Iltimos, telefoningiz modelini yozib yuboring (masalan, iPhone 15 Pro Max):',
    customModelTooLong: '⚠️ Model nomi 200 belgidan oshmasligi kerak. Qisqaroq nom yuboring.',
    staleAction: '🔄 Bu tugma eskirgan. /start orqali jarayonni qayta boshlang.',
    emptyProblems:
      '📝 Ushbu model uchun tayyor muammolar ro‘yxati yo‘q. Muammoni izohda yozishingiz mumkin.',
    invalidPhone: '⚠️ Telefon raqami noto‘g‘ri. O‘zbekiston raqamini qayta ulashing.',
    maintenance: '🛠 Texnik ishlar ketmoqda. Iltimos, keyinroq urinib ko‘ring.',
    unavailable: '📡 Xizmat vaqtincha ishlamayapti. Iltimos, keyinroq urinib ko‘ring.',
    restartRequired:
      '🔄 Procare bot yangilandi. Davom etishdan oldin /start buyrug‘i orqali botni qayta boshlang.',
    orders: '📦 Mening buyurtmalarim',
    adminTemplates: '🧩 Xabar shablonlari',
    adminStatusNames: '🏷 Status nomlari',
    adminExport: '📊 Excel eksport',
    settings: '⚙️ Sozlamalar',
    settingsTitle: '⚙️ Sozlamalar bo‘limi. Qaysi ma’lumotni boshqaramiz?',
    settingsCurrent:
      '⚙️ <b>Joriy sozlamalaringiz</b>\n\n👤 <b>Ism:</b> {{name}}\n📱 <b>Telefon:</b> {{phone}}\n🌐 <b>Til:</b> {{language}}\n\nKerakli bo‘limni tanlab, ma’lumotlarni yangilashingiz mumkin.',
    settingsNotProvided: 'Kiritilmagan',
    settingsLanguageUzbek: 'O‘zbekcha',
    settingsLanguageRussian: 'Ruscha',
    settingsName: '👤 Ism',
    settingsPhone: '📱 Telefon raqami',
    settingsLanguage: '🌐 Til',
    settingsBack: '⬅️ Menyuga qaytish',
    settingsNamePrompt: '👤 Ism va familiyangizni yuboring. Masalan: Ali Valiyev',
    settingsNameInvalid:
      '⚠️ Ism 2-120 belgi bo‘lishi kerak. Iltimos, ism va familiyangizni qayta yuboring.',
    settingsNameUpdated: '✅ Ismingiz “{{name}}” qilib yangilandi.',
    settingsPhonePrompt:
      '📱 Telefon raqamini yangilash uchun o‘zingizga tegishli raqamni tugma orqali ulashing.',
    settingsPhoneUpdated: '✅ Telefon raqamingiz tasdiqlandi va profil yangilandi.',
    settingsPhoneNotFound:
      '🔎 Bu raqam bo‘yicha faol Procare profili topilmadi. Boshqa raqamni ulashing.',
    settingsLanguagePrompt: '🌐 Interfeys tilini tanlang:',
    settingsLanguageUpdated: '✅ Til sozlamasi yangilandi.',
    settingsUnavailable:
      '⚠️ Sozlamalarni hozir yangilab bo‘lmadi. Iltimos, keyinroq urinib ko‘ring.',
    noOrders: '📭 Sizda hozircha ta’mirlash buyurtmalari yo‘q.',
    ordersLoading: '🔄 Buyurtmalaringiz yangilanmoqda...',
    ordersUnavailable:
      '📡 Buyurtmalarni hozir yuklab bo‘lmadi. Iltimos, keyinroq qayta urinib ko‘ring.',
    orderNotFound: '🔎 Bu buyurtma topilmadi yoki endi ko‘rish uchun mavjud emas.',
    ordersRefresh: '🔄 Yangilash',
    orderRefresh: '🔄 Yangilash',
    ordersBack: '◀️ Buyurtmalar',
    orderMap: '📍 Xarita',
    orderChecklist: '📋 Qabul akti',
    orderWarrantyDocument: '🛡 Kafolat',
    orderOffer: '📄 Ommaviy oferta',
    orderSupport: '💬 Xodimga yozish',
    supportPrompt:
      '💬 #{{number}} buyurtma bo‘yicha chat boshlandi.\n\n📋 <b>Suhbat qoidalari:</b>\n ├ ✍️ <b>Matn yoki rasm</b> — xabarlaringiz avtomatik tarzda xodimlarga yuboriladi.\n ├ 📎 <b>Rasmlar</b> — bir vaqtda 5 tagacha rasm yuborish mumkin (har biri max 5 MB).\n ├ ↩️ <b>Javob qaytarish</b> — xodimning xabariga reply (javob) yuborishingiz mumkin.\n └ 👍 <b>Tasdiqlash</b> — xabar yetkazilganda bot unga avtomatik 👍 reaksiyasini qoldiradi.\n\n👇 Xabaringizni yozib qoldiring yoki suhbatni yakunlash uchun tugmani bosing:',
    supportEndChat: '🔚 Suhbatni tugatish',
    supportEnded: '✅ Suhbat tugatildi.',
    supportCancel: '✖️ Bekor qilish',
    supportCancelled: '✅ Xabar yuborish bekor qilindi.',
    supportEmpty: '⚠️ Xabar bo‘sh bo‘lmasligi kerak. Matn yoki rasm yuboring.',
    supportTooLong: '⚠️ Xabar 4000 belgidan oshmasligi kerak. Qisqaroq matn yuboring.',
    supportPhotoTooLarge: '⚠️ Rasm hajmi 5 MB dan oshmasligi kerak.',
    supportPhotosTruncated: '⚠️ Tizim cheklovlari tufayli faqat birinchi 5 ta rasm yuborildi.',
    supportPhotoUnavailable:
      '⚠️ Rasmni hozir yuklab bo‘lmadi. Iltimos, qayta yuboring yoki matn yozing.',
    supportSending: '📨 Xabaringiz yuborilmoqda...',
    supportSent: '✅ Xabaringiz Procare xodimlariga yuborildi.',
    supportDuplicate: '✅ Bu xabar allaqachon qabul qilingan.',
    supportUnavailable:
      '📡 Xabarni hozir yuborib bo‘lmadi. Iltimos, keyinroq qayta urinib ko‘ring.',
    supportOrderUnavailable: '🔄 Avval buyurtma ma’lumotlarini qayta oching.',
    supportAdminNotification:
      '💬 Buyurtma #{{number}} bo‘yicha yangi mijoz xabari bor.\nID: <code>{{id}}</code>\n\nIltimos, CRM’da tekshiring.',
    registerFirst: '📲 Avval /start buyrug‘i orqali telefon raqamingizni ulang.',
    help: '💬 Yordam kerakmi? Telefon raqamingizni ulashing yoki /start buyrug‘ini yuboring.',
    clientHelp:
      '✨ <b>PROCARE CLIENT PORTAL</b> ✨\n\n📋 <b>Menyu orqali quyidagi amallarni bajarishingiz mumkin:</b>\n ├ 📦 <b>Mening buyurtmalarim</b> — faol va yakunlangan buyurtmalar holatini ko‘rish\n ├ ✍️ <b>Ariza qoldirish</b> — yangi ta’mirlash uchun tezkor ariza yuborish\n └ ⚙️ <b>Sozlamalar</b> — profilingiz ma’lumotlarini yangilash\n\n👇 Kerakli bo‘limni tanlang:',
    employeeHelp:
      '🛡️ <b>PROCARE WORKPLACE</b> 🛡️\n\n🛠️ <b>Ishchi vositalar:</b>\n ├ 🔍 <b>Mijozlar qidiruvi</b> — mijozlarni qidirish va xabarlar yuborish\n ├ 🧩 <b>Xabar shablonlari</b> — xabar shablonlarini boshqarish va yaratish\n ├ 🏷 <b>Status nomlari</b> — buyurtma statuslarining mijozga ko‘rinadigan nomlarini tahrirlash\n ├ 📤 <b>Excel eksport</b> — hisobotlarni Excel formatida yuklab olish\n └ ⚙️ <b>Sozlamalar</b> — shaxsiy ma’lumotlarni tahrirlash\n\n👇 Boshlash uchun bo‘limni tanlang:',
    logoutSuccess: '👋 Siz tizimdan chiqdingiz. Qayta boshlash uchun /start buyrug‘ini yuboring.',
    logoutFailed: '⚠️ Hozir tizimdan chiqib bo‘lmadi. Iltimos, keyinroq urinib ko‘ring.',
    commandStart: 'Procare botini boshlash yoki qayta boshlash',
    commandHelp: 'Yordam olish',
    commandLogout: 'Tizimdan chiqish',
    adminTemplatesTitle: '🧩 Xabar shablonlari',
    adminTemplatesEmpty: 'Hozircha shablonlar yo‘q.',
    adminTemplateCreate: '➕ Shabloni qo‘shish',
    adminTemplateBackToMenu: '⬅️ Menyuga qaytish',
    adminTemplateBack: '⬅️ Shablonlar ro‘yxati',
    adminTemplateEditKey: 'Kalit',
    adminTemplateEditType: 'Turi',
    adminTemplateEditTitle: 'Sarlavha',
    adminTemplateEditUz: 'UZ matni',
    adminTemplateEditRu: 'RU matni',
    adminTemplateDeactivate: 'O‘chirish',
    adminTemplateActivate: 'Yoqish',
    adminTemplateDelete: '🗑 O‘chirish',
    adminTemplateDeleted: '✅ Shablon o‘chirildi.',
    adminTemplateSaved: '✅ Shablon yaratildi.',
    adminTemplateUpdated: '✅ Shablon yangilandi.',
    adminTemplateStatusUpdated: '✅ Shablon holati yangilandi.',
    adminTemplateNotFound: 'Shablon topilmadi.',
    adminTemplateInvalidValue: 'Qiymat noto‘g‘ri. Iltimos, qayta yuboring.',
    adminTemplateGuidance:
      '📝 Yangi xabar shabloni yaratish bo‘yicha yo‘riqnoma\n\n1. <b>Sarlavha</b>: admin ichida ko‘rinadigan nom. Masalan: Kafolat hujjati\n2. <b>Kalit</b>: noyob bo‘lishi kerak. Faqat lotincha yozing. Masalan: warranty_document_v1\n3. <b>Tur</b>: xabar qaysi hodisa uchun ishlashini belgilaydi.\n4. <b>Matn</b>: o‘zgaruvchilarni <code>{{customer_name}}</code> kabi formatda yozing.\n\nMijozga shablon xabar yuborishda bot avtomatik to‘ldiradigan qiymatlar:\n- <code>{{customer_name}}</code> - mijozning ismi va familiyasi\n- <code>{{first_name}}</code> - mijozning ismi\n- <code>{{last_name}}</code> - mijozning familiyasi\n- <code>{{phone_number}}</code> - mijoz telefoni\n- <code>{{employee_name}}</code> - xodimning ismi\n- <code>{{problem_label}}</code> - muammo turi\n\nBoshqa placeholderlar ham ishlaydi, lekin bot yuborishdan oldin ularning qiymatini admindan so‘raydi. <code>{{coupon_code}}</code> qiymati berilsa, avtomatik inline-code formatiga o‘tadi.\n\nBekor qilish uchun istalgan bosqichda “❌ Bekor qilish” tugmasini bosing.',
    adminTemplatePromptKey: 'Shablon kalitini kiriting. Masalan: order_success',
    adminTemplatePromptType: 'Shablon turini tanlang:',
    adminTemplatePromptTitle: 'Shablon sarlavhasini kiriting:',
    adminTemplatePromptUz:
      'O‘zbekcha matnni kiriting (<code>{{var}}</code> formatidagi o‘zgaruvchilardan foydalanishingiz mumkin):',
    adminTemplatePromptRu:
      'Ruscha matnni kiriting (<code>{{var}}</code> formatidagi o‘zgaruvchilardan foydalanishingiz mumkin):',
    adminTemplateCancel: '❌ Bekor qilish',
    adminTemplateCancelled: '❌ Bekor qilindi.',
    adminTemplateUnavailable: '❌ Xatolik yuz berdi.',
    adminStatusNamesTitle: '🏷 Buyurtma statuslarining mijozga ko‘rinadigan nomlari',
    adminStatusNamesEmpty: 'CRM’dan statuslar topilmadi.',
    adminStatusNamesRefresh: '🔄 CRM’dan yangilash',
    adminStatusNameDetail:
      '<b>{{crmName}}</b>\n\nCRM ID: <code>{{crmStatusId}}</code>\n\n<b>Mijozga ko‘rinadigan nomlar</b>\nUZ: {{displayUz}}\nRU: {{displayRu}}',
    adminStatusNameEditUz: 'UZ nomi',
    adminStatusNameEditRu: 'RU nomi',
    adminStatusNamePromptUz:
      'Mijoz Telegramda ko‘radigan o‘zbekcha status nomini yuboring. Masalan: Javobingiz kutilmoqda',
    adminStatusNamePromptRu:
      'Mijoz Telegramda ko‘radigan ruscha status nomini yuboring. Masalan: Ожидаем ваш ответ',
    adminStatusNameSaved: '✅ Status nomi saqlandi.',
    adminStatusNameInvalid:
      '⚠️ Nom 1-120 belgi bo‘lishi kerak. Iltimos, mijozga tushunarli qisqa nom yuboring.',
    adminStatusNameNotFound: 'Status topilmadi.',
    adminStatusNameCancel: '✖️ Bekor qilish',
    adminStatusNameCancelled: '✅ Status nomini tahrirlash bekor qilindi.',
    adminStatusNameUnavailable:
      '⚠️ Statuslarni hozir yuklab yoki saqlab bo‘lmadi. Keyinroq urinib ko‘ring.',
    adminClients: '🔍 Mijozlar qidiruvi',
    adminClientSearchPrompt:
      '🔍 Mijozning ismi, familiyasi, username yoki telefon raqamini yozib yuboring (masalan: Ali yoki +998...):',
    adminClientListTitle: '👥 Topilgan mijozlar:',
    adminClientNotFound: '🔎 Mos mijoz topilmadi.',
    adminClientSearchFailed:
      '⚠️ Qidiruvda xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko‘ring.',
    adminClientSendCustom: '✉️ Shaxsiy xabar',
    adminClientSendTemplate: '🧩 Shablon xabar',
    adminClientCustomPrompt: '✍️ Mijozga yuboriladigan shaxsiy xabar matnini kiriting:',
    adminClientCustomPreview: '📋 Shaxsiy xabar oldindan ko‘rinishi:',
    adminClientTemplateSelectPrompt: '🧩 Yubormoqchi bo‘lgan shabloningizni tanlang:',
    adminClientTemplatePlaceholderPrompt:
      'Iltimos, shablon uchun <b>{{key}}</b> qiymatini kiriting:',
    adminClientTemplatePreview: '📋 Shablon xabar oldindan ko‘rinishi:',
    adminClientSendConfirm: '✅ Yuborish',
    adminClientSendCancel: '✖️ Bekor qilish',
    adminClientCancel: '✖️ Bekor qilish',
    adminClientMessageSent: '✅ Xabar muvaffaqiyatli yuborildi.',
    adminClientMessageFailed: '⚠️ Xabarni yuborib bo‘lmadi. Mijoz botni bloklagan bo‘lishi mumkin.',
    adminClientBack: '⬅️ Orqaga',
    adminExportPrompt:
      '📤 Excel eksport uchun davrni yuboring.\n\nFormat: <code>2026-06-01 2026-06-25</code>\nDavr Toshkent vaqti bo‘yicha, ikkala sana ham kiradi.',
    adminExportGenerating: '⏳ Excel fayl tayyorlanmoqda...',
    adminExportInvalidPeriod:
      '⚠️ Davr noto‘g‘ri. Iltimos, ikkita sanani <code>YYYY-MM-DD YYYY-MM-DD</code> formatida yuboring.',
    adminExportStartAfterEnd: '⚠️ Boshlanish sanasi tugash sanasidan keyin bo‘lmasligi kerak.',
    adminExportReady: '✅ Excel eksport tayyor: {{from}} - {{to}}.',
    adminExportUnavailable: '⚠️ Excel eksportni hozir tayyorlab bo‘lmadi. Keyinroq urinib ko‘ring.',
    adminExportCancel: '✖️ Bekor qilish',
    adminExportCancelled: '✅ Excel eksport bekor qilindi.',
    developerApiEndpoints: '⚙️ API endpointlar',
    developerHelp:
      '⚙️ <b>PROCARE DEVELOPER CORE</b> ⚙️\n\n💻 Salom, <b>Tuzuvchi</b>!\nTizim to‘liq nazorat ostida. API va sozlashlar paneli tayyor.\n\n🛠️ <b>Ishchi menyu:</b>\n ├ ⚙️ <b>API endpointlar</b> — integratsiya nuqtalari va xatoliklar\n ├ ⚙️ <b>Sozlamalar</b> — shaxsiy sozlamalar\n └ <i>Hamda faollashtirilgan mijoz/xodim boshqaruv tugmalari</i>\n\n👇 Kerakli vositani tanlang:',
    developerPhoneAccepted:
      '✅ Developer test rejimi yoqildi. Ushbu raqam test uchun qabul qilindi: <code>{{phone}}</code>.',
    developerEndpointsTitle: '🛠 Bot ishlatayotgan API endpointlar:',
    developerEndpointTitle:
      '<b>{{title}}</b>\n\n<code>{{method}} {{path}}</code>\nAuth: <code>{{auth}}</code>\n\n{{description}}\n\nLocation lokalizatsiyalari: {{count}}',
    developerEndpointEmpty:
      'Bu endpoint uchun hali location lokalizatsiyalari yo‘q. Yangi location qo‘shishingiz mumkin.',
    developerLocalizationAdd: '➕ Location qo‘shish',
    developerLocalizationEdit: '✏️ Tahrirlash',
    developerLocalizationTitle: '<b>{{location}}</b>\n\nUZ:\n{{messageUz}}\n\nRU:\n{{messageRu}}',
    developerLocalizationPromptLocation:
      'Endpoint xatosidagi <code>location</code> tokenini yuboring. Masalan: <code>phone_number</code>',
    developerLocalizationPromptUz: 'Ushbu location uchun o‘zbekcha xabar matnini yuboring:',
    developerLocalizationPromptRu: 'Ushbu location uchun ruscha xabar matnini yuboring:',
    developerLocalizationSaved: '✅ Location lokalizatsiyasi saqlandi.',
    developerLocalizationInvalid:
      '⚠️ Qiymat noto‘g‘ri. Location 1-120 belgi bo‘lishi, xabarlar esa 2-1000 belgi bo‘lishi kerak.',
    developerLocalizationNotFound: 'Location lokalizatsiyasi topilmadi.',
    developerUnavailable:
      '⚠️ Developer ma’lumotlarini hozir yuklab bo‘lmadi. Keyinroq urinib ko‘ring.',
    developerCancel: '✖️ Bekor qilish',
    developerCancelled: '✅ Developer amali bekor qilindi.',
    developerEndpointBack: '⬅️ Endpointga qaytish',
    developerBackToMenu: '⬅️ Menyuga qaytish',
    language: '🇷🇺 Русский',
    uzbek: '🇺🇿 O‘zbekcha',
    russian: '🇷🇺 Русский',
  },
  ru: {
    chooseLanguage: '🌐 Qulay tilni tanlang / Выберите удобный язык:',
    welcome:
      '✨ Здравствуйте! Добро пожаловать в сервисного помощника Procare.\n\n📲 Поделитесь своим номером телефона, чтобы видеть заказы и быстро оформить ремонт.',
    sharePhone: '📱 Поделиться номером',
    phoneOnly: '📌 Пожалуйста, для безопасности отправьте свой номер телефона с помощью кнопки.',
    registering: '🔎 Проверяем ваши данные...',
    registered:
      '✨ <b>PROCARE CLIENT PORTAL</b> ✨\n\n👋 Здравствуйте, <b>{{name}}</b>!\nМы рады, что вы пользуетесь услугами нашего сервиса.\n\n📋 <b>Через меню вы можете выполнить следующие действия:</b>\n ├ 📦 <b>Мои заказы</b> — просмотр статуса активных и завершенных заказов\n ├ ✍️ <b>Оставить заявку</b> — быстрая отправка новой заявки на ремонт\n └ ⚙️ <b>Настройки</b> — редактирование информации вашего профиля\n\n👇 Выберите нужный раздел:',
    adminRegistered:
      '🛡️ <b>PROCARE WORKPLACE</b> 🛡️\n\n👋 Здравствуйте, <b>{{name}}</b>!\nВы авторизованы с ролью <b>Сотрудник</b>.\n\n🛠️ <b>Рабочие инструменты:</b>\n ├ 🔍 <b>Поиск клиентов</b> — поиск пользователей и отправка сообщений\n ├ 🧩 <b>Шаблоны сообщений</b> — управление шаблонами рассылок\n ├ 🏷 <b>Названия статусов</b> — локализация статусов заказов\n ├ 📤 <b>Экспорт в Excel</b> — выгрузка отчетов по периодам\n └ ⚙️ <b>Настройки</b> — параметры личного профиля\n\n👇 Выберите инструмент для работы:',
    notFound:
      '🔎 Активный клиент с таким номером не найден. Оформим новую заявку на ремонт прямо сейчас?',
    leaveRequest: '🛠 Оставить заявку',
    declineRequest: '⏳ Позже',
    requestDeclined:
      '✅ Ваши данные сохранены. Когда будете готовы, начните заново с помощью команды /start.',
    chooseOs: '📱 Выберите операционную систему телефона:',
    noOsTypes: '🕓 Типы телефонов пока недоступны. Попробуйте позже.',
    chooseCategory: '📲 Выберите модель телефона:',
    noCategories: '📭 В этом разделе модели телефонов не найдены.',
    chooseProblems:
      '🧰 Отметьте неисправности. Можно выбрать несколько вариантов, затем нажмите «➡️ Продолжить»:',
    continue: '➡️ Продолжить',
    back: '⬅️ Назад',
    enterNote:
      '✍️ Напишите дополнительное примечание к заявке. Если примечания нет, нажмите «⏭ Продолжить без примечания».',
    skipNote: '⏭ Продолжить без примечания',
    noteTooLong: '⚠️ Примечание не должно превышать 9000 символов. Отправьте более короткий текст.',
    confirmRequest: '📋 Проверьте данные заявки:',
    confirm: '✅ Подтвердить',
    cancel: '✖️ Отменить',
    submittingRequest: '🚀 Отправляем заявку...',
    requestCreated: '🎉 Ваша заявка принята. Номер заявки: {{number}}.',
    requestCancelled: '✅ Заявка отменена, ваши данные сохранены.',
    requestUnavailable: '⚠️ Сейчас не удалось отправить заявку. Попробуйте позже.',
    requestRateLimited: '⏱ Слишком много попыток. Повторите немного позже.',
    requestDuplicate:
      '⚠️ Активная заявка для этого номера телефона и модели уже существует. Дождитесь рассмотрения предыдущей заявки.',
    leaveRequestMenu: '✍️ Оставить заявку',
    leaveRequestIntro: '🛠 Новая заявка на ремонт. Выберите тип телефона:',
    modelNotListed: 'Модели нет в списке',
    enterCustomModel: 'Пожалуйста, введите модель вашего телефона (например, iPhone 15 Pro Max):',
    customModelTooLong:
      '⚠️ Название модели не должно превышать 200 символов. Отправьте более короткое название.',
    staleAction: '🔄 Эта кнопка устарела. Начните заново с помощью /start.',
    emptyProblems:
      '📝 Для этой модели нет готового списка неисправностей. Вы можете описать проблему в примечании.',
    invalidPhone: '⚠️ Неверный номер. Пожалуйста, отправьте номер Узбекистана повторно.',
    maintenance: '🛠 Ведутся технические работы. Попробуйте позже.',
    unavailable: '📡 Сервис временно недоступен. Попробуйте позже.',
    restartRequired:
      '🔄 Procare bot обновлён. Перед продолжением перезапустите бота командой /start.',
    orders: '📦 Мои заказы',
    adminTemplates: '🧩 Шаблоны сообщений',
    adminStatusNames: '🏷 Названия статусов',
    adminExport: '📊 Excel экспорт',
    settings: '⚙️ Настройки',
    settingsTitle: '⚙️ Раздел настроек. Что хотите изменить?',
    settingsCurrent:
      '⚙️ <b>Ваши текущие настройки</b>\n\n👤 <b>Имя:</b> {{name}}\n📱 <b>Телефон:</b> {{phone}}\n🌐 <b>Язык:</b> {{language}}\n\nВыберите нужный раздел, чтобы обновить данные.',
    settingsNotProvided: 'Не указан',
    settingsLanguageUzbek: 'Узбекский',
    settingsLanguageRussian: 'Русский',
    settingsName: '👤 Имя',
    settingsPhone: '📱 Номер телефона',
    settingsLanguage: '🌐 Язык',
    settingsBack: '⬅️ Вернуться в меню',
    settingsNamePrompt: '👤 Отправьте имя и фамилию. Например: Ali Valiyev',
    settingsNameInvalid:
      '⚠️ Имя должно быть от 2 до 120 символов. Отправьте имя и фамилию ещё раз.',
    settingsNameUpdated: '✅ Имя обновлено: «{{name}}».',
    settingsPhonePrompt: '📱 Чтобы обновить номер, отправьте свой номер телефона с помощью кнопки.',
    settingsPhoneUpdated: '✅ Номер телефона подтверждён, профиль обновлён.',
    settingsPhoneNotFound:
      '🔎 Активный профиль Procare с таким номером не найден. Отправьте другой номер.',
    settingsLanguagePrompt: '🌐 Выберите язык интерфейса:',
    settingsLanguageUpdated: '✅ Язык обновлён.',
    settingsUnavailable: '⚠️ Сейчас не удалось обновить настройки. Попробуйте позже.',
    noOrders: '📭 У вас пока нет заказов на ремонт.',
    ordersLoading: '🔄 Обновляем ваши заказы...',
    ordersUnavailable: '📡 Сейчас не удалось загрузить заказы. Попробуйте ещё раз позже.',
    orderNotFound: '🔎 Заказ не найден или больше недоступен для просмотра.',
    ordersRefresh: '🔄 Обновить',
    orderRefresh: '🔄 Обновить',
    ordersBack: '◀️ Заказы',
    orderMap: '📍 Карта',
    orderChecklist: '📋 Акт приёма',
    orderWarrantyDocument: '🛡 Гарантия',
    orderOffer: '📄 Публичная оферта',
    orderSupport: '💬 Написать сотруднику',
    supportPrompt:
      '💬 Чат по заказу #{{number}} начат.\n\n📋 <b>Правила чата:</b>\n ├ ✍️ <b>Текст или фото</b> — ваши сообщения автоматически отправляются сотрудникам.\n ├ 📎 <b>Фотографии</b> — можно отправить до 5 фото за один раз (каждое макс. 5 МБ).\n ├ ↩️ <b>Ответы</b> — вы можете отвечать прямо на сообщения сотрудников (через reply).\n └ 👍 <b>Подтверждение</b> — при успешной доставке бот автоматически ставит реакцию 👍.\n\n👇 Напишите ваше сообщение или нажмите кнопку ниже для завершения чата:',
    supportEndChat: '🔚 Завершить чат',
    supportEnded: '✅ Чат завершён.',
    supportCancel: '✖️ Отмена',
    supportCancelled: '✅ Отправка сообщения отменена.',
    supportEmpty: '⚠️ Сообщение не должно быть пустым. Отправьте текст или фото.',
    supportTooLong: '⚠️ Сообщение не должно превышать 4000 символов. Отправьте короче.',
    supportPhotoTooLarge: '⚠️ Размер фото не должен превышать 5 МБ.',
    supportPhotosTruncated: '⚠️ Из-за ограничений системы были отправлены только первые 5 фото.',
    supportPhotoUnavailable:
      '⚠️ Сейчас не удалось загрузить фото. Отправьте его ещё раз или напишите текстом.',
    supportSending: '📨 Отправляем сообщение...',
    supportSent: '✅ Сообщение отправлено сотрудникам Procare.',
    supportDuplicate: '✅ Это сообщение уже принято.',
    supportUnavailable: '📡 Сейчас не удалось отправить сообщение. Попробуйте позже.',
    supportOrderUnavailable: '🔄 Сначала откройте данные заказа заново.',
    supportAdminNotification:
      '💬 По заказу #{{number}} есть новое сообщение от клиента.\nID: <code>{{id}}</code>\n\nПожалуйста, проверьте в CRM.',
    registerFirst: '📲 Сначала отправьте номер телефона через команду /start.',
    help: '💬 Нужна помощь? Поделитесь номером телефона или отправьте команду /start.',
    clientHelp:
      '✨ <b>PROCARE CLIENT PORTAL</b> ✨\n\n📋 <b>Через меню вы можете выполнить следующие действия:</b>\n ├ 📦 <b>Мои заказы</b> — просмотр статуса активных и завершенных заказов\n ├ ✍️ <b>Оставить заявку</b> — быстрая отправка новой заявки на ремонт\n └ ⚙️ <b>Настройки</b> — редактирование информации вашего профиля\n\n👇 Выберите нужный раздел:',
    employeeHelp:
      '🛡️ <b>PROCARE WORKPLACE</b> 🛡️\n\n🛠️ <b>Рабочие инструменты:</b>\n ├ 🔍 <b>Поиск клиентов</b> — поиск пользователей и отправка сообщений\n ├ 🧩 <b>Шаблоны сообщений</b> — управление шаблонами рассылок\n ├ 🏷 <b>Названия статусов</b> — локализация статусов заказов\n ├ 📤 <b>Экспорт в Excel</b> — выгрузка отчетов по периодам\n └ ⚙️ <b>Настройки</b> — параметры личного профиля\n\n👇 Выберите инструмент для работы:',
    logoutSuccess: '👋 Вы вышли из системы. Чтобы начать заново, отправьте /start.',
    logoutFailed: '⚠️ Сейчас не удалось выйти из системы. Попробуйте позже.',
    commandStart: 'Начать или перезапустить Procare',
    commandHelp: 'Получить помощь',
    commandLogout: 'Выйти из системы',
    adminTemplatesTitle: '🧩 Шаблоны сообщений',
    adminTemplatesEmpty: 'Шаблонов пока нет.',
    adminTemplateCreate: '➕ Новый шаблон',
    adminTemplateBackToMenu: '⬅️ Вернуться в меню',
    adminTemplateBack: '⬅️ К списку шаблонов',
    adminTemplateEditKey: 'Ключ',
    adminTemplateEditType: 'Тип',
    adminTemplateEditTitle: 'Заголовок',
    adminTemplateEditUz: 'UZ текст',
    adminTemplateEditRu: 'RU текст',
    adminTemplateDeactivate: 'Отключить',
    adminTemplateActivate: 'Включить',
    adminTemplateDelete: '🗑 Удалить',
    adminTemplateDeleted: '✅ Шаблон удалён.',
    adminTemplateSaved: '✅ Шаблон успешно создан.',
    adminTemplateUpdated: '✅ Шаблон обновлён.',
    adminTemplateStatusUpdated: '✅ Статус шаблона изменён.',
    adminTemplateNotFound: 'Шаблон не найден.',
    adminTemplateInvalidValue: 'Некорректное значение. Отправьте ещё раз.',
    adminTemplateGuidance:
      '📝 Инструкция по созданию нового шаблона сообщения\n\n1. <b>Название</b>: имя шаблона внутри админки. Пример: Гарантийный документ\n2. <b>Ключ</b>: должен быть уникальным. Используйте латиницу. Пример: warranty_document_v1\n3. <b>Тип</b>: определяет событие, для которого будет использоваться шаблон.\n4. <b>Текст</b>: переменные пишутся в формате <code>{{customer_name}}</code>.\n\nПри отправке шаблона клиенту бот заполняет автоматически:\n- <code>{{customer_name}}</code> - имя и фамилию клиента\n- <code>{{first_name}}</code> - имя клиента\n- <code>{{last_name}}</code> - фамилию клиента\n- <code>{{phone_number}}</code> - телефон клиента\n- <code>{{employee_name}}</code> - имя сотрудника\n- <code>{{problem_label}}</code> - тип проблемы\n\nДругие placeholderы тоже работают, но перед отправкой бот спросит их значения у админа. Если передать <code>{{coupon_code}}</code>, значение автоматически форматируется как inline-code.\n\nЧтобы отменить создание, на любом шаге нажмите кнопку “❌ Отмена”.',
    adminTemplatePromptKey: 'Введите уникальный ключ шаблона. Например: warranty_card',
    adminTemplatePromptType: 'Выберите тип шаблона:',
    adminTemplatePromptTitle: 'Введите название шаблона:',
    adminTemplatePromptUz:
      'Введите текст сообщения на узбекском (используйте <code>{{placeholder_name}}</code> для переменных):',
    adminTemplatePromptRu:
      'Введите текст сообщения на русском (используйте <code>{{placeholder_name}}</code> для переменных):',
    adminTemplateCancel: '❌ Отмена',
    adminTemplateCancelled: '❌ Отменено.',
    adminTemplateUnavailable: '❌ Произошла ошибка.',
    adminStatusNamesTitle: '🏷 Клиентские названия статусов заказов',
    adminStatusNamesEmpty: 'Статусы из CRM не найдены.',
    adminStatusNamesRefresh: '🔄 Обновить из CRM',
    adminStatusNameDetail:
      '<b>{{crmName}}</b>\n\nCRM ID: <code>{{crmStatusId}}</code>\n\n<b>Клиентские названия</b>\nUZ: {{displayUz}}\nRU: {{displayRu}}',
    adminStatusNameEditUz: 'UZ название',
    adminStatusNameEditRu: 'RU название',
    adminStatusNamePromptUz:
      'Отправьте узбекское название статуса, которое клиент увидит в Telegram. Например: Javobingiz kutilmoqda',
    adminStatusNamePromptRu:
      'Отправьте русское название статуса, которое клиент увидит в Telegram. Например: Ожидаем ваш ответ',
    adminStatusNameSaved: '✅ Название статуса сохранено.',
    adminStatusNameInvalid:
      '⚠️ Название должно быть от 1 до 120 символов. Отправьте короткое понятное название для клиента.',
    adminStatusNameNotFound: 'Статус не найден.',
    adminStatusNameCancel: '✖️ Отмена',
    adminStatusNameCancelled: '✅ Редактирование названия статуса отменено.',
    adminStatusNameUnavailable:
      '⚠️ Сейчас не удалось загрузить или сохранить статусы. Попробуйте позже.',
    adminClients: '🔍 Поиск клиентов',
    adminClientSearchPrompt:
      '🔍 Введите имя, фамилию, username или номер телефона клиента (например: Ali или +998...):',
    adminClientListTitle: '👥 Найденные клиенты:',
    adminClientNotFound: '🔎 Совпадающие клиенты не найдены.',
    adminClientSearchFailed: '⚠️ Ошибка при поиске. Пожалуйста, попробуйте позже.',
    adminClientSendCustom: '✉️ Личное сообщение',
    adminClientSendTemplate: '🧩 Шаблонное сообщение',
    adminClientCustomPrompt: '✍️ Введите текст личного сообщения для клиента:',
    adminClientCustomPreview: '📋 Предварительный просмотр личного сообщения:',
    adminClientTemplateSelectPrompt: '🧩 Выберите шаблон для отправки:',
    adminClientTemplatePlaceholderPrompt:
      'Пожалуйста, введите значение для <b>{{key}}</b> для шаблона:',
    adminClientTemplatePreview: '📋 Предварительный просмотр шаблонного сообщения:',
    adminClientSendConfirm: '✅ Отправить',
    adminClientSendCancel: '✖️ Отмена',
    adminClientCancel: '✖️ Отмена',
    adminClientMessageSent: '✅ Сообщение успешно отправлено.',
    adminClientMessageFailed:
      '⚠️ Не удалось отправить сообщение. Возможно, клиент заблокировал бота.',
    adminClientBack: '⬅️ Назад',
    adminExportPrompt:
      '📤 Отправьте период для Excel-экспорта.\n\nФормат: <code>2026-06-01 2026-06-25</code>\nПериод считается по времени Ташкента, обе даты включительно.',
    adminExportGenerating: '⏳ Готовим Excel-файл...',
    adminExportInvalidPeriod:
      '⚠️ Неверный период. Отправьте две даты в формате <code>YYYY-MM-DD YYYY-MM-DD</code>.',
    adminExportStartAfterEnd: '⚠️ Дата начала не должна быть позже даты окончания.',
    adminExportReady: '✅ Excel-экспорт готов: {{from}} - {{to}}.',
    adminExportUnavailable: '⚠️ Сейчас не удалось подготовить Excel-экспорт. Попробуйте позже.',
    adminExportCancel: '✖️ Отмена',
    adminExportCancelled: '✅ Excel-экспорт отменён.',
    developerApiEndpoints: '⚙️ API endpoints',
    developerHelp:
      '⚙️ <b>PROCARE DEVELOPER CORE</b> ⚙️\n\n💻 Привет, <b>Разработчик</b>!\nСистема под полным контролем. Панель API и конфигураций готова.\n\n🛠️ <b>Рабочее меню:</b>\n ├ ⚙️ <b>API эндпоинты</b> — точки интеграции и локализация ошибок\n ├ ⚙️ <b>Настройки</b> — личные параметры\n └ <i>А также активные кнопки клиента/сотрудника</i>\n\n👇 Выберите инструмент для работы:',
    developerPhoneAccepted:
      '✅ Developer test mode включён. Этот номер принят для теста: <code>{{phone}}</code>.',
    developerEndpointsTitle: '🛠 API endpoints, которые использует бот:',
    developerEndpointTitle:
      '<b>{{title}}</b>\n\n<code>{{method}} {{path}}</code>\nAuth: <code>{{auth}}</code>\n\n{{description}}\n\nЛокализаций location: {{count}}',
    developerEndpointEmpty:
      'Для этого endpoint пока нет локализаций location. Можно добавить новый location.',
    developerLocalizationAdd: '➕ Добавить location',
    developerLocalizationEdit: '✏️ Изменить',
    developerLocalizationTitle: '<b>{{location}}</b>\n\nUZ:\n{{messageUz}}\n\nRU:\n{{messageRu}}',
    developerLocalizationPromptLocation:
      'Отправьте token <code>location</code> из ошибки endpoint. Например: <code>phone_number</code>',
    developerLocalizationPromptUz: 'Отправьте узбекский текст сообщения для этого location:',
    developerLocalizationPromptRu: 'Отправьте русский текст сообщения для этого location:',
    developerLocalizationSaved: '✅ Локализация location сохранена.',
    developerLocalizationInvalid:
      '⚠️ Некорректное значение. Location должен быть 1-120 символов, сообщения 2-1000 символов.',
    developerLocalizationNotFound: 'Локализация location не найдена.',
    developerUnavailable: '⚠️ Сейчас не удалось загрузить Developer-данные. Попробуйте позже.',
    developerCancel: '✖️ Отмена',
    developerCancelled: '✅ Developer-действие отменено.',
    developerEndpointBack: '⬅️ Вернуться к endpoint',
    developerBackToMenu: '⬅️ Вернуться в меню',
    language: '🇺🇿 O‘zbekcha',
    uzbek: '🇺🇿 O‘zbekcha',
    russian: '🇷🇺 Русский',
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
