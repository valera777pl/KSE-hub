import 'dotenv/config';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { serve } from '@hono/node-server';
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

const app = new Hono();

// ─── Global Middleware ───
app.use('*', logger());
app.use('*', cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use('*', errorHandler);

// ─── Health Check ───
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

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

app.route('/api', api);

import fs from 'fs';
import { serveStatic } from '@hono/node-server/serve-static';

// ─── Serve Frontend Static Files (Production SPA) ───
const staticRoot = fs.existsSync(path.resolve(process.cwd(), 'public'))
  ? './public'
  : (fs.existsSync(path.resolve(process.cwd(), '../client/dist')) ? '../client/dist' : './public');

app.use('/*', serveStatic({ root: staticRoot }));
app.get('*', serveStatic({ path: `${staticRoot}/index.html` }));

// ─── Start Server ───
const port = parseInt(process.env.PORT || '3001');

console.log(`
╔═══════════════════════════════════════╗
║         🎓 KSE Hub API Server        ║
║       Running on port ${port}           ║
╚═══════════════════════════════════════╝
`);

serve({ fetch: app.fetch, port });
