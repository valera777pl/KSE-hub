# KSE Hub

Telegram-бот [@ksehub_bot](https://t.me/ksehub_bot) і мініапп для студентів Київської школи економіки: дайджести пошти й Moodle, розклад і спільні пари, ІІ-помічник (бронювання кімнат, дедлайни, база знань KSE), стартапи та стажування.

Що зроблено і що далі — у [PLAN.md](PLAN.md).

## Як влаштовано

| Частина | Де | Що робить |
|---|---|---|
| Мініапп | `client/` (React + Vite) | Весь інтерфейс і налаштування, реєстрація, адмінка на `/admin` |
| Сервер | `server/` (Hono) | API мініаппу, вебхук бота, `/cron/tick` |
| База | Neon Postgres + pgvector | Дані, кеш стислих листів, база знань KSE |
| ІІ | Gemini (одна модель) | Помічник у боті й мініаппі, стислий зміст листів, ембединги |
| Хостинг | Vercel (`vercel.json`: сервіси `client` і `server`) | Деплой з гілки `main` |
| Будильник | cron-job.org → `POST /cron/tick` кожні 10 хв | Пошта, розклад, нагадування, дайджести |

## Локальний запуск

```bash
cp .env.example .env        # заповнити ключі
cd server && npm install && npm run db:sql && npm run dev   # API на :3001
cd client && npm install && npm run dev                     # мініапп на :5173
```

Поза Telegram мініапп працює від тестового користувача (`X-Dev-User-Id`, лише з `NODE_ENV=development`).

## Команди сервера

| Команда | Що робить |
|---|---|
| `npm run db:sql` | Застосовує `src/db/sql/*.sql` (ідемпотентно). `drizzle-kit push` не використовуємо: він неправильно читає Postgres 18 |
| `npm run kb:ingest` | Оновлює базу знань KSE: сайти KSE + внутрішні документи з `kb-docs/` (вони лише локально, у git не потрапляють) |
| `npm test` | Автотести |
| `npm run typecheck` | Перевірка типів |

## Після деплою

Зареєструвати вебхук і команди бота (один раз або після зміни команд):

```bash
curl -X POST https://kse-hub.vercel.app/bot/setup -H "Authorization: Bearer $BOT_SECRET"
```

Адмінка: написати боту `/admin` (лише для адміністраторів) → посилання на 30 днів.
