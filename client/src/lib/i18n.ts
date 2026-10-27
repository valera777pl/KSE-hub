import { create } from 'zustand';

/* Two languages, side by side in the code: t('Сьогодні', 'Today'). Ukrainian by default (PRODUCT.md). */

export type Lang = 'uk' | 'en';

export const useLang = create<{ lang: Lang; setLang: (l: Lang) => void }>((set) => ({
  lang: 'uk',
  setLang: (lang) => { document.documentElement.lang = lang; set({ lang }); },
}));

export const lang = () => useLang.getState().lang;
/** Outside React (formatters): picks the string for the current language. */
export const tr = (uk: string, en: string) => (lang() === 'en' ? en : uk);
/** Intl locale for dates and numbers */
export const locale = () => (lang() === 'en' ? 'en-GB' : 'uk-UA');

/** In components: re-renders when the language changes. */
export function useT() {
  const l = useLang((s) => s.lang);
  return (uk: string, en: string) => (l === 'en' ? en : uk);
}
