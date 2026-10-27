import { useEffect, useRef, useState } from 'react';

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

/* ─── Theme: our own tokens for both schemes (DESIGN.md → Цвет); Telegram only says light or dark ─── */

const TOKENS = {
  dark: {
    '--bg': '#0B0D12', '--surface': '#161920', '--inset': '#1F232C', '--fill': '#161920', '--surface-2': '#2C313C',
    '--separator': '#2A2E38', '--text': '#F3F5F9', '--text-secondary': '#A0A7B4', '--text-tertiary': '#7B8291',
    '--title-inactive': '#6B7280', '--accent': '#6B76F5', '--accent-fill': '#3645F2', '--on-accent': '#FFFFFF',
    '--brand-card': '#070F6B', '--brand-text-2': '#C9D2FF', '--tabbar-bg': '#11141A', '--tab-inactive': '#8A91A0',
    '--avatar-bg': '#3A3F4B', '--success': '#2E9E68', '--success-fill': '#278658', '--warning': '#F0A95A',
    '--danger': '#FF6B6B', '--danger-fill': '#FF5C5C',
  },
  light: {
    '--bg': '#F2F3F7', '--surface': '#FFFFFF', '--inset': '#F2F3F7', '--fill': '#E6E8EE', '--surface-2': '#FFFFFF',
    '--separator': '#E3E5EB', '--text': '#0B0D12', '--text-secondary': '#5F6675', '--text-tertiary': '#676F7F',
    '--title-inactive': '#868D9D', '--accent': '#2B3BD6', '--accent-fill': '#2B3BD6', '--on-accent': '#FFFFFF',
    '--brand-card': '#070F6B', '--brand-text-2': '#C9D2FF', '--tabbar-bg': '#FFFFFF', '--tab-inactive': '#6B7280',
    '--avatar-bg': '#D9DCE3', '--success': '#1E7C4F', '--success-fill': '#1E7C4F', '--warning': '#AB5800',
    '--danger': '#D52828', '--danger-fill': '#D52828',
  },
} as const;

/** "auto" follows Telegram; the student can pin light or dark in the profile (CloudStorage "theme"). */
export type ThemePref = 'auto' | 'light' | 'dark';
const THEME_KEY = 'theme';
// This device's copy paints the first frame right; CloudStorage (other devices) answers a moment later
const LOCAL_THEME_KEY = 'kh:theme';
const isPref = (v: unknown): v is ThemePref => v === 'auto' || v === 'light' || v === 'dark';
let themePref: ThemePref = (() => {
  try { const v = localStorage.getItem(LOCAL_THEME_KEY); return isPref(v) ? v : 'auto'; } catch { return 'auto'; }
})();

export function currentScheme(): 'light' | 'dark' {
  if (themePref !== 'auto') return themePref;
  return tg()?.colorScheme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

export function applyTheme() {
  const app = tg();
  const scheme = currentScheme();
  const tokens = TOKENS[scheme];
  const root = document.documentElement;
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
  root.dataset.theme = scheme;
  root.style.colorScheme = scheme;
  if (app) {
    try {
      app.setHeaderColor(tokens['--bg']);
      app.setBackgroundColor(tokens['--bg']);
      app.setBottomBarColor?.(tokens['--tabbar-bg']);
    } catch { /* older clients */ }
  }
  themeListeners.forEach((cb) => cb());
  return tokens;
}

const themeListeners = new Set<() => void>();
/** Re-render when the scheme changes (MainButton colours are set from JS). */
export function onThemeApplied(cb: () => void) {
  themeListeners.add(cb);
  return () => { themeListeners.delete(cb); };
}

export const getThemePref = () => themePref;

export function setThemePref(pref: ThemePref) {
  themePref = pref;
  try { localStorage.setItem(LOCAL_THEME_KEY, pref); } catch { /* storage blocked */ }
  cloud.set(THEME_KEY, pref);
  applyTheme();
}

export function initTelegram() {
  const app = tg();
  applyTheme();
  // A pinned light/dark from the profile; until it arrives the Telegram scheme shows
  cloud.get(THEME_KEY).then((v) => {
    if (isPref(v) && v !== themePref) setThemePref(v);
  });
  if (!app) return;
  app.ready();
  app.expand();
  if (can('7.7')) app.disableVerticalSwipes?.();
  // Telegram switched its theme: follow it only while the student hasn't pinned one
  app.onEvent('themeChanged', () => { if (themePref === 'auto') applyTheme(); });
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

  // Telegram draws the button itself, so a theme switch has to repaint it from here
  const [scheme, setScheme] = useState(currentScheme);
  useEffect(() => onThemeApplied(() => setScheme(currentScheme())), []);

  useEffect(() => {
    const btn = tg()?.MainButton;
    if (!btn) return;
    const css = getComputedStyle(document.documentElement);
    btn.setParams({
      text,
      color: disabled ? css.getPropertyValue('--fill').trim() : css.getPropertyValue('--accent-fill').trim(),
      text_color: disabled ? css.getPropertyValue('--text-secondary').trim() : css.getPropertyValue('--on-accent').trim(),
      is_active: !disabled,
      is_visible: visible,
    });
    if (loading) btn.showProgress(false); else btn.hideProgress();
  }, [text, visible, disabled, loading, scheme]);
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
