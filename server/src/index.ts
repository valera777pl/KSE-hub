import 'dotenv/config';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { telegramAuth } from './middleware/telegramAuth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { roomRoutes } from './routes/rooms.js';
import { moodleRoutes } from './routes/moodle.js';
import { ventureRoutes } from './routes/venture.js';
import { careerRoutes } from './routes/careers.js';
import { copilotRoutes } from './routes/copilot.js';
import { userRoutes } from './routes/users.js';
import { notificationRoutes } from './routes/notifications.js';
import { botRoutes, cronRoutes } from './routes/bot.js';
import { googleCallback, googleRoutes } from './routes/google.js';
import { scheduleRoutes } from './routes/schedule.js';
import { adminRoutes } from './routes/admin.js';
import { mailRoutes } from './routes/mail.js';
import { authRoutes } from './routes/auth.js';
import { friendRoutes } from './routes/friends.js';
import { reminderRoutes } from './routes/reminders.js';
import { eventRoutes } from './routes/events.js';

const app = new Hono();

// ─── Global Middleware ───
// Paths only: query strings can carry what a student typed (?q=surname)
app.use('*', logger((line, ...rest) => console.log(line.replace(/\?\S*/, ''), ...rest)));
app.use('*', cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.onError(errorHandler);

// ─── Health Check ───
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── Telegram bot webhook & scheduled jobs (own auth, no initData) ───
app.route('/bot', botRoutes);
app.route('/cron', cronRoutes);

// Google redirects the browser here without Telegram initData; must be mounted before /api auth
app.route('/api/google', googleCallback);
// Admin dashboard has its own auth (bot link or admin's initData)
app.route('/api/admin', adminRoutes);

// ─── Protected Routes (Telegram Auth required) ───
const api = new Hono();
api.use('*', telegramAuth);

api.route('/rooms', roomRoutes);
api.route('/moodle', moodleRoutes);
api.route('/venture', ventureRoutes);
api.route('/careers', careerRoutes);
api.route('/copilot', copilotRoutes);
api.route('/users', userRoutes);
api.route('/notifications', notificationRoutes);
api.route('/google', googleRoutes);
api.route('/schedule', scheduleRoutes);
api.route('/mail', mailRoutes);
api.route('/auth', authRoutes);
api.route('/friends', friendRoutes);
api.route('/reminders', reminderRoutes);
api.route('/events', eventRoutes);

app.route('/api', api);

export default app;
