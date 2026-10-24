import * as path from 'path';
import fs from 'fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import app from './index.js';

// Local / Docker entry point. On Vercel, src/index.ts is used directly.

// ─── Serve the built mini app if it exists (npm run build in client/); in dev use Vite on :5173 ───
const staticRoot = '../client/dist';

if (fs.existsSync(path.resolve(process.cwd(), staticRoot))) {
  app.use('/*', serveStatic({ root: staticRoot }));
  app.get('*', serveStatic({ path: `${staticRoot}/index.html` }));
}

// ─── Start Server ───
const port = parseInt(process.env.PORT || '3001');

console.log(`
╔═══════════════════════════════════════╗
║         🎓 KSE Hub API Server        ║
║       Running on port ${port}           ║
╚═══════════════════════════════════════╝
`);

serve({ fetch: app.fetch, port });
