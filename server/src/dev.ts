import * as path from 'path';
import fs from 'fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import app from './index.js';

// Local / Docker entry point. On Vercel, src/index.ts is used directly.

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
