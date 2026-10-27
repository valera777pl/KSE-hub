import { useEffect, useRef } from 'react';

/* Thin typed layer over window.Telegram.WebApp. Outside Telegram every call is a no-op. */

type ThemeParams = Partial<Record<
  | 'bg_color' | 'secondary_bg_color' | 'section_bg_color' | 'text_color' | 'hint_color'
  | 'subtitle_text_color' | 'section_separator_color' | 'destructive_text_color' | 'link_color'
  | 'header_bg_color' | 'bottom_bar_bg_color',
  string
>>;

interface BottomButton {
  setParams(p: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean; has_shine_effect?: boolean }): void;
  show(): void;
  hide(): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface WebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name: string; last_name?: string; username?: string; photo_url?: string; language_code?: string }; start_param?: string };
  colorScheme: 'light' | 'dark';
  themeParams: ThemeParams;
  version: string;
  ready(): void;
  expand(): void;
  isVersionAtLeast(v: string): boolean;
  onEvent(e: string, cb: () => void): void;
  offEvent(e: string, cb: () => void): void;
  setHeaderColor(c: string): void;
  setBackgroundColor(c: string): void;
  setBottomBarColor?(c: string): void;
  disableVerticalSwipes?(): void;
  openLink(url: string): void;
  openTelegramLink(url: string): void;
  MainButton: BottomButton;
  SecondaryButton?: BottomButton;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback: { selectionChanged(): void; impactOccurred(s: 'light' | 'medium' | 'heavy' | 'soft' | 'rigid'): void; notificationOccurred(t: 'success' | 'error' | 'warning'): void };
  CloudStorage?: { getItem(k: string, cb: (err: unknown, v?: string) => void): void; setItem(k: string, v: string, cb?: (err: unknown) => void): void };
}

export const tg = (): WebApp | null => {
  const app = (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;
  // The SDK script defines WebApp even in a plain browser; it only counts when Telegram launched us
  return app && (app.initData || app.initDataUnsafe?.user) ? app : null;
};

const can = (v: string) => !!tg()?.isVersionAtLeast?.(v);

/* ─── Theme: Telegram backgrounds and text, our own blue accent (DESIGN.md) ─── */

const FALLBACK = {
  light: { bg: '#efeff4', surface: '#ffffff', text: '#000000', hint: '#8e8e93', separator: '#c8c7cc', danger: '#e53935' },
  dark: { bg: '#000000', surface: '#1c1c1d', text: '#ffffff', hint: '#98989e', separator: '#38383a', danger: '#ff6b6b' },
};
const ACCENT = { light: { accent: '#2341ee', onAccent: '#ffffff', warn: '#a35400' }, dark: { accent: '#6f86ff', onAccent: '#0b0c18', warn: '#f0a95a' } };

export function currentScheme(): 'light' | 'dark' {
  return tg()?.colorScheme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

export function applyTheme() {
  const app = tg();
  const scheme = currentScheme();
  const p = app?.themeParams ?? {};
  const f = FALLBACK[scheme];
  const a = ACCENT[scheme];
  const tokens = {
    '--bg': p.secondary_bg_color || f.bg,
    '--surface': p.section_bg_color || p.bg_color || f.surface,
    '--text': p.text_color || f.text,
    '--hint': p.subtitle_text_color || p.hint_color || f.hint,
    '--separator': p.section_separator_color || f.separator,
    '--danger': p.destructive_text_color || f.danger,
    '--accent': a.accent,
    '--on-accent': a.onAccent,
    '--warn': a.warn,
  };
  const root = document.documentElement;
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
  root.dataset.theme = scheme;
  if (app) {
    try {
      app.setHeaderColor(tokens['--bg']);
      app.setBackgroundColor(tokens['--bg']);
      app.setBottomBarColor?.(tokens['--surface']);
    } catch { /* older clients */ }
  }
  return tokens;
}

export function initTelegram() {
  const app = tg();
  applyTheme();
  if (!app) return;
  app.ready();
  app.expand();
  if (can('7.7')) app.disableVerticalSwipes?.();
  app.onEvent('themeChanged', applyTheme);
}

/* ─── Haptics ─── */

export const haptic = {
  select: () => { try { tg()?.HapticFeedback.selectionChanged(); } catch { /* not in Telegram */ } },
  tap: () => { try { tg()?.HapticFeedback.impactOccurred('light'); } catch { /* not in Telegram */ } },
  success: () => { try { tg()?.HapticFeedback.notificationOccurred('success'); } catch { /* not in Telegram */ } },
  error: () => { try { tg()?.HapticFeedback.notificationOccurred('error'); } catch { /* not in Telegram */ } },
};

/* ─── Links ─── */

export function openExternal(url: string) {
  const app = tg();
  if (app) app.openLink(url);
  else window.open(url, '_blank');
}

/** Deep link from the bot: t.me/<bot>/<app>?startapp=day_2026-10-27 → "day_2026-10-27" */
export function startParam(): string | null {
  return tg()?.initDataUnsafe.start_param ?? new URLSearchParams(location.search).get('startapp');
}

/* ─── Native bottom buttons ─── */

interface MainButtonOptions {
  text: string;
  onClick: () => void;
  visible?: boolean;
  disabled?: boolean;
  loading?: boolean;
}

/** The screen's one primary action, drawn by Telegram under the web view. */
export function useMainButton({ text, onClick, visible = true, disabled = false, loading = false }: MainButtonOptions) {
  const handler = useRef(onClick);
  handler.current = onClick;

  useEffect(() => {
    const btn = tg()?.MainButton;
    if (!btn) return;
    const cb = () => handler.current();
    btn.onClick(cb);
    return () => { btn.offClick(cb); btn.hide(); };
  }, []);

  useEffect(() => {
    const btn = tg()?.MainButton;
    if (!btn) return;
    const css = getComputedStyle(document.documentElement);
    btn.setParams({
      text,
      color: disabled ? css.getPropertyValue('--separator').trim() : css.getPropertyValue('--accent').trim(),
      text_color: disabled ? css.getPropertyValue('--hint').trim() : css.getPropertyValue('--on-accent').trim(),
      is_active: !disabled,
      is_visible: visible,
    });
    if (loading) btn.showProgress(false); else btn.hideProgress();
  }, [text, visible, disabled, loading]);
}

/* Back is a stack: a sheet opened over the profile takes Back first, and when it closes
   the profile gets it back. The arrow shows while anything is on the stack. */
const backStack: { current: (() => void) | null }[] = [];
let backBound = false;
const onBackPressed = () => backStack[backStack.length - 1]?.current?.();

function syncBack() {
  const btn = tg()?.BackButton;
  if (!btn) return;
  if (!backBound) { btn.onClick(onBackPressed); backBound = true; }
  if (backStack.length) btn.show(); else btn.hide();
}

/** Telegram's own back arrow in the header, while `onBack` is set. */
export function useBackButton(onBack: (() => void) | null) {
  const handler = useRef(onBack);
  handler.current = onBack;
  const active = !!onBack;

  useEffect(() => {
    if (!active) return;
    backStack.push(handler);
    syncBack();
    return () => {
      backStack.splice(backStack.indexOf(handler), 1);
      syncBack();
    };
  }, [active]);
}

/* ─── Small per-user storage that follows the student across devices ─── */

export const cloud = {
  get(key: string): Promise<string | null> {
    const cs = tg()?.CloudStorage;
    if (!cs || !can('6.9')) {
      try { return Promise.resolve(localStorage.getItem(key)); } catch { return Promise.resolve(null); }
    }
    return new Promise((resolve) => cs.getItem(key, (err, v) => resolve(err ? null : v || null)));
  },
  set(key: string, value: string) {
    const cs = tg()?.CloudStorage;
    if (!cs || !can('6.9')) {
      try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
      return;
    }
    cs.setItem(key, value);
  },
};
