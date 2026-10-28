import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles/ui.css';
import { applyTheme, tg } from './lib/telegram';

async function start() {
  // Dev-only stand-in for Telegram + API (?mock=1); tree-shaken out of production builds
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('mock')) await import('./dev/mock');
  // Telegram hides its own loader on ready(): from here our splash is what the student sees.
  // Our colours go on before the first React frame, so the screen under the splash is already right.
  try { tg()?.ready(); } catch { /* outside Telegram */ }
  applyTheme();
  // The admin dashboard is its own chunk: students never download it
  const Page = window.location.pathname.startsWith('/admin')
    ? (await import('./components/admin/AdminPage')).AdminPage
    : (await import('./App')).default;
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Page />
    </StrictMode>
  );
}

start();
