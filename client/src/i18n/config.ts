import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

i18n.use(initReactI18next).init({
  fallbackLng: 'uk',
  supportedLngs: ['uk', 'en'],
  ns: ['translation'],
  defaultNS: 'translation',
  interpolation: {
    escapeValue: false,
  },
  backend: {
    loadPath: '/locales/{{lng}}/{{ns}}.json',
  },
  resources: {},
  react: {
    useSuspense: false,
  },
});

// Load translations dynamically
async function loadTranslations(lang: string) {
  try {
    const response = await fetch(`/locales/${lang}/translation.json`);
    const translations = await response.json();
    i18n.addResourceBundle(lang, 'translation', translations, true, true);
  } catch (err) {
    console.warn(`Failed to load ${lang} translations:`, err);
  }
}

// Preload both languages
Promise.all([loadTranslations('uk'), loadTranslations('en')]);

export default i18n;
