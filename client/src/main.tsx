import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n/config';
import './index.css';
import './styles/ui.css';

async function start() {
  // Dev-only stand-in for Telegram + API (?mock=1); tree-shaken out of production builds
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('mock')) await import('./dev/mock');
  const [{ default: App }, { AdminPage }] = await Promise.all([import('./App'), import('./components/admin/AdminPage')]);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {window.location.pathname.startsWith('/admin') ? <AdminPage /> : <App />}
    </StrictMode>
  );
}

start();
