import { AlertCircle, CloudOff, RotateCcw, WifiOff, type LucideIcon } from 'lucide-react';
import { locale, tr } from '../../lib/i18n';
import { hm } from '../../lib/time';
import { haptic, tg } from '../../lib/telegram';
import { errorText, errorTitle, toApiError } from '../../api/client';

/** One sentence on why it's empty and at most one thing to do about it. */
export function EmptyState({ icon: Icon, title, text, action }: {
  icon: LucideIcon; title: string; text?: string; action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="empty">
      <Icon strokeWidth={1.75} />
      <b>{title}</b>
      {text && <p>{text}</p>}
      {action && <button className="link-btn" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

/** Grey placeholders shaped like the rows that are about to load. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="group" aria-busy="true" aria-label={tr('Завантаження', 'Loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="class" key={i}>
          <div><div className="skel" style={{ height: 14, width: 40 }} /><div className="skel" style={{ height: 12, width: 34, marginTop: 6 }} /></div>
          <div><div className="skel" style={{ height: 14, width: '45%' }} /><div className="skel" style={{ height: 12, width: '70%', marginTop: 6 }} /></div>
        </div>
      ))}
    </div>
  );
}

/** Data is from the cache because the refresh failed: say so, when it's from, and offer one retry. */
export function StaleBanner({ at, error, busy, onRetry }: { at: number; error: unknown; busy?: boolean; onRetry: () => void }) {
  const when = new Date(at);
  const today = when.toDateString() === new Date().toDateString();
  const stamp = today ? hm(when) : `${when.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}, ${hm(when)}`;
  return (
    <div className="stale" role="status">
      <AlertCircle strokeWidth={1.8} />
      <div className="stale__text">
        <b>{toApiError(error).kind === 'network' ? tr('Немає звʼязку', 'No connection') : tr('Не вдалося оновити', 'Couldn\'t refresh')}</b>
        <span>{tr('Показуємо дані на', 'Showing data from')} {stamp}</span>
      </div>
      <button className="link-btn" disabled={busy} onClick={() => { haptic.tap(); onRetry(); }}>{busy ? tr('Оновлюю…', 'Refreshing…') : tr('Оновити', 'Refresh')}</button>
    </div>
  );
}

/** Nothing cached and the request failed: the real reason and a retry. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const kind = toApiError(error).kind;
  return (
    <div className="group">
      <EmptyState icon={kind === 'network' ? WifiOff : CloudOff} title={errorTitle(error)} text={errorText(error)}
        action={{ label: tr('Спробувати ще раз', 'Try again'), onClick: onRetry }} />
    </div>
  );
}

/** Sign-in is gone (stale initData, or opened outside the bot's button). Only reopening fixes it. */
export function SignInLost() {
  const app = tg() as unknown as { close?: () => void } | null;
  return (
    <div className="screen screen--center">
      <EmptyState icon={RotateCcw} title={tr('Не вдалося увійти', 'Couldn\'t sign in')}
        text={tr('Закрий і відкрий KSE Hub з меню бота.', 'Close and reopen KSE Hub from the bot menu.')}
        action={app?.close ? { label: tr('Закрити', 'Close'), onClick: () => app.close?.() } : undefined} />
    </div>
  );
}
