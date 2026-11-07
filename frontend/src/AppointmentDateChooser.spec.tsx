// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppointmentDateChooser } from './AppointmentDateChooser';
import { I18nProvider } from './i18n/i18n';

describe('AppointmentDateChooser button-only local calendar', () => {
  let root: Root;
  let host: HTMLDivElement;
  const change = vi.fn();
  beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.setItem('shop-calendar-locale', 'en');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    change.mockClear();
    await act(async () => root.render(<I18nProvider>
      <AppointmentDateChooser value="02/28/2028" onChange={change} />
    </I18nProvider>));
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  const click = async (selector: string) => {
    await act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
  };
  it('has no text/date inputs or clear action; typing, pasting and Delete cannot change dates', async () => {
    await click('button');
    expect(host.querySelector('input, textarea, [contenteditable]')).toBeNull();
    expect(host.querySelectorAll('.appointment-date-grid button')).toHaveLength(42);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('02/28/2028');
    await act(async () => {
      for (const key of ['1', 'Backspace', 'Delete']) {
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      }
      document.activeElement!.dispatchEvent(new Event('paste', { bubbles: true }));
      document.activeElement!.dispatchEvent(new Event('input', { bubbles: true }));
      document.activeElement!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(change).not.toHaveBeenCalled();
    await click('[aria-label="02/29/2028"]');
    expect(change).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledWith('02/29/2028');
    expect(host.querySelector('.appointment-date-panel')).toBeNull();
    expect(document.activeElement?.textContent).toBe('Choose date');
  });
  it('navigates across years, permits past dates and dismisses without mutating the value', async () => {
    await click('button');
    await click('[aria-label="Prev"]');
    await click('[aria-label="Prev"]');
    expect(host.textContent).toContain('December 2027');
    await click('[aria-label="12/31/2027"]');
    expect(change).toHaveBeenCalledWith('12/31/2027');
    change.mockClear();
    await click('button');
    await act(async () => document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('.appointment-date-panel')).toBeNull();
    expect(change).not.toHaveBeenCalled();
    await click('button');
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(host.querySelector('.appointment-date-panel')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });
});
