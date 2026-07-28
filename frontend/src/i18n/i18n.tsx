import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LOCALE, messages, type Locale, type MessageKey, SUPPORTED_LOCALES } from './messages';

const STORAGE_KEY = 'shop-calendar-locale';

type TranslationValues = Record<string, string | number>;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, values?: TranslationValues) => string;
}

const normalizeLocale = (value: string | null | undefined): Locale | null => {
  if (!value) {
    return null;
  }

  if (SUPPORTED_LOCALES.includes(value as Locale)) {
    return value as Locale;
  }

  if (value.toLowerCase().startsWith('zh')) {
    return 'zh-CN';
  }

  if (value.toLowerCase().startsWith('en')) {
    return 'en';
  }

  return null;
};

export const detectBrowserLocale = (): Locale => {
  if (typeof navigator === 'undefined') {
    return DEFAULT_LOCALE;
  }

  return normalizeLocale(navigator.language) ?? DEFAULT_LOCALE;
};

export const getInitialLocale = (): Locale => {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE;
  }

  const stored = normalizeLocale(window.localStorage.getItem(STORAGE_KEY));
  if (stored) {
    return stored;
  }

  return detectBrowserLocale();
};

const interpolate = (template: string, values?: TranslationValues) => {
  if (!values) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
};

const createTranslator = (locale: Locale) => {
  return (key: MessageKey, values?: TranslationValues) => {
    const template = messages[locale][key] ?? messages.en[key] ?? key;
    return interpolate(template, values);
  };
};

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
  t: createTranslator(DEFAULT_LOCALE),
});

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [locale, setLocaleState] = useState<Locale>(() => getInitialLocale());

  const setLocale = (nextLocale: Locale) => {
    setLocaleState(nextLocale);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, nextLocale);
    }
  };

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: createTranslator(locale),
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => useContext(I18nContext);
