# 🎓 KSE Hub — Telegram Mini App for Kyiv School of Economics

All-in-one Telegram Mini App (TMA) для студентів Київської Школи Економіки (KSE), що об'єднує ключові університетські сценарії в єдиному сучасному інтерфейсі.

---

## 🚀 Основні модулі

1. **🏢 Room Booking (Модуль 1)**
   - Бронювання кімнат (Skype Rooms та Silent Boxes) у кампусі KSE.
   - Захист від овербукінгу через транзакції та advisory locks у PostgreSQL.
   - Денний ліміт 3 години на студента (Quota bar).
   - "Hot Booking" в 1 клік на найближчі 30 хвилин.

2. **📚 Moodle Companion (Модуль 2)**
   - Синхронізація з Moodle KSE через токен мобільного додатку.
   - Дедлайн-радар (Deadline Radar) із відліком часу та статусом готовності.
   - Перелік та огляд навчальних курсів.

3. **🤝 VentureMatch (Модуль 3)**
   - Тіндер-подібний нетворкінг для стартапів та студентів KSE.
   - Свайпи профілів та проектів (react-spring / touch gestures).
   - Автоматичне виявлення взаємного метчу та пряме посилання у Telegram (`tg://user?id=...`).

4. **💼 Careers & Grants (Модуль 4)**
   - Каталог стажувань, грантів, вакансій та досліджень.
   - Фільтрація за типом фінансування (Грант / Контракт / Всі), дедлайнами та напрямками.

5. **🤖 AI Campus Copilot (Модуль 5)**
   - Асистент на базі OpenAI GPT-4o з підтримкою Function Calling (Tool Calling).
   - Автоматичне виконання дій: бронювання вільних кімнат, перевірка дедлайнів, пошук можливостей.

---

## 🛠 Технологічний стек

- **Frontend**: React 18, TypeScript, Vite, Vanilla CSS Design System (з підтримкою змінних Telegram WebApp), Zustand, i18next (UK/EN).
- **Backend**: Node.js, Hono, Drizzle ORM, OpenAI SDK, ical.js, Zod.
- **Database**: PostgreSQL 16.
- **Real-time / Auth**: SSE (Server-Sent Events), HMAC-SHA256 верифікація Telegram `initData`.
- **DevOps**: Docker & Docker Compose.

---

## ⚡ Швидкий старт (Локальна розробка)

### 1. Клонування та налаштування змінних оточення

Створіть `.env` файл на основі шаблону:

```bash
cp .env.example .env
```

Заповніть необхідні параметри:
- `TELEGRAM_BOT_TOKEN`
- `OPENAI_API_KEY`
- `DATABASE_URL`

### 2. Запуск через Docker Compose

```bash
docker compose up --build
```

- Клієнт: [http://localhost:5173](http://localhost:5173)
- Бекенд API: [http://localhost:3001](http://localhost:3001)

### 3. Локальний запуск без Docker

#### Бекенд:
```bash
cd server
npm install
npm run db:push     # застосування схеми до вашої БД
npm run db:seed     # наповнення початковими кімнатами та тестовими даними
npm run dev
```

#### Фронтенд:
```bash
cd client
npm install
npm run dev
```

---

## 🧪 Збірка та перевірка

- **Typecheck & Build Client**: `cd client && npm run build`
- **Typecheck & Build Server**: `cd server && npm run build`
