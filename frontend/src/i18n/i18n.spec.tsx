// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectBrowserLocale, getInitialLocale, I18nProvider, useI18n } from './i18n';
import { messages } from './messages';

const setNavigatorLanguage = (value: string) => {
  Object.defineProperty(window.navigator, 'language', {
    configurable: true,
    value,
  });
};

const TestHarness = () => {
  const { locale, setLocale, t } = useI18n();

  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="sign-in-label">{t('login.signIn')}</span>
      <button type="button" onClick={() => setLocale('zh-CN')}>set-zh</button>
    </div>
  );
};

describe('i18n provider', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    setNavigatorLanguage('en-US');
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('detects zh browser locale on first load', () => {
    setNavigatorLanguage('zh-CN');
    expect(detectBrowserLocale()).toBe('zh-CN');
    expect(getInitialLocale()).toBe('zh-CN');
  });

  it('persists selected locale to localStorage', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <TestHarness />
        </I18nProvider>,
      );
    });

    const button = container.querySelector('button');
    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(window.localStorage.getItem('shop-calendar-locale')).toBe('zh-CN');

    await act(async () => {
      root.unmount();
    });
  });

  it('falls back to english when a zh key is missing', async () => {
    const original = (messages as any)['zh-CN']['login.signIn'];
    (messages as any)['zh-CN']['login.signIn'] = undefined;
    window.localStorage.setItem('shop-calendar-locale', 'zh-CN');

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <TestHarness />
        </I18nProvider>,
      );
    });

    const label = container.querySelector('[data-testid="sign-in-label"]');
    expect(label?.textContent).toBe(messages.en['login.signIn']);

    (messages as any)['zh-CN']['login.signIn'] = original;

    await act(async () => {
      root.unmount();
    });
  });
});
