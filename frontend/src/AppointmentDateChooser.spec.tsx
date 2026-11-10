// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppointmentDateChooser } from './AppointmentDateChooser';
import { I18nProvider } from './i18n/i18n';

function ControlledChooser({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState('02/28/2028');
  return <>
    <output data-testid="date-value">{value}</output>
    <AppointmentDateChooser value={value} onChange={(date) => { setValue(date); onChange(date); }} />
    <button type="button" data-testid="outside">Outside</button>
  </>;
}

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
      <ControlledChooser onChange={change} />
    </I18nProvider>));
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  const click = async (selector: string) => {
    await act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
  };
  // Synthetic touch ordering, not a real Safari reproduction. Separate act
  // boundaries let blur-triggered unmounts finish before the eventual click.
  const touchStartAndBlur = async (selector: string) => {
    const target = host.querySelector<HTMLButtonElement>(selector)!;
    await act(async () => target.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 1 })));
    const focused = document.activeElement as HTMLElement;
    let relatedTarget: EventTarget | null | undefined;
    focused.addEventListener('focusout', (event) => { relatedTarget = event.relatedTarget; }, { once: true });
    await act(async () => focused.blur());
    expect(relatedTarget).toBeNull();
    return target;
  };
  const touchFinish = async (target: HTMLButtonElement) => {
    await act(async () => target.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 1 })));
    await act(async () => target.click());
  };
  it('commits the controlled date after touch blur with null relatedTarget precedes click', async () => {
    await click('button');
    const target = await touchStartAndBlur('[aria-label="02/29/2028"]');
    expect(change).not.toHaveBeenCalled();
    expect(host.querySelector('.appointment-date-panel')).not.toBeNull();
    expect(target.isConnected).toBe(true);
    await touchFinish(target);
    expect(change).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledWith('02/29/2028');
    expect(host.querySelector('[data-testid="date-value"]')?.textContent).toBe('02/29/2028');
    expect(host.querySelector('.appointment-date-panel')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('button'));
    await click('button');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('02/29/2028');
  });
  it('keeps month navigation and trigger toggling working after internal touch blur', async () => {
    await click('button');
    await touchFinish(await touchStartAndBlur('[aria-label="Next"]'));
    expect(host.textContent).toContain('March 2028');
    expect(host.querySelector('.appointment-date-panel')).not.toBeNull();
    expect(change).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="03/01/2028"]')!.focus());
    await touchFinish(await touchStartAndBlur('button'));
    expect(host.querySelector('.appointment-date-panel')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });
  it('still closes on an outside pointer after internal touch blur without committing', async () => {
    await click('button');
    await touchStartAndBlur('[aria-label="02/29/2028"]');
    await act(async () => host.querySelector('[data-testid="outside"]')!.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })));
    expect(host.querySelector('.appointment-date-panel')).toBeNull();
    expect(change).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="date-value"]')?.textContent).toBe('02/28/2028');
  });
  it('still closes on Escape after internal touch blur and restores trigger focus', async () => {
    await click('button');
    const target = await touchStartAndBlur('[aria-label="02/29/2028"]');
    await act(async () => target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(host.querySelector('.appointment-date-panel')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('button'));
    expect(change).not.toHaveBeenCalled();
  });
  it('does not guard focus moving to an actual outside control during a pointer interaction', async () => {
    await click('button');
    await act(async () => host.querySelector('[aria-label="02/29/2028"]')!.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="outside"]')!.focus());
    expect(host.querySelector('.appointment-date-panel')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[data-testid="outside"]'));
    expect(change).not.toHaveBeenCalled();
  });
  it('still closes on null-target blur when no internal pointer interaction is pending', async () => {
    await click('button');
    await act(async () => (document.activeElement as HTMLElement).blur());
    expect(host.querySelector('.appointment-date-panel')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });
  it.each([false, true])('preserves Tab navigation inside and closes on leaving (shift=%s)', async (shiftKey) => {
    await click('button');
    const target = await touchStartAndBlur('[aria-label="02/29/2028"]');
    await act(async () => target.focus());
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }));
      host.querySelector<HTMLButtonElement>('[aria-label="Next"]')!.focus();
    });
    expect(host.querySelector('.appointment-date-panel')).not.toBeNull();
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }));
      host.querySelector<HTMLButtonElement>('[data-testid="outside"]')!.focus();
    });
    expect(host.querySelector('.appointment-date-panel')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[data-testid="outside"]'));
    expect(change).not.toHaveBeenCalled();
  });
  it('closes on null-target keyboard blur after an internal pointer interaction', async () => {
    await click('button');
    const target = await touchStartAndBlur('[aria-label="02/29/2028"]');
    await act(async () => target.focus());
    await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    await act(async () => target.blur());
    expect(host.querySelector('.appointment-date-panel')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });
  it('clears the pointer guard on cancel and on a completed month-navigation click', async () => {
    await click('button');
    let target = await touchStartAndBlur('[aria-label="Next"]');
    await act(async () => target.dispatchEvent(
      new PointerEvent('pointercancel', { bubbles: true, pointerType: 'touch', pointerId: 1 })));
    await act(async () => target.focus());
    await act(async () => target.blur());
    expect(host.querySelector('.appointment-date-panel')).toBeNull();
    await click('button');
    target = await touchStartAndBlur('[aria-label="Next"]');
    await touchFinish(target);
    await act(async () => target.focus());
    await act(async () => target.blur());
    expect(host.querySelector('.appointment-date-panel')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });
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
