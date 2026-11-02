// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeDateChooser } from './NativeDateChooser';
import { I18nProvider } from './i18n/i18n';

describe('NativeDateChooser', () => {
  let root: Root;
  let host: HTMLDivElement;
  let original: PropertyDescriptor | undefined;
  const change = vi.fn();
  const error = vi.fn();
  beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.setItem('shop-calendar-locale', 'en');
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    original = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'showPicker');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    change.mockClear(); error.mockClear();
    await act(async () => {
      root.render(<I18nProvider><NativeDateChooser value="12/31/2027" onChange={change} onError={error} /></I18nProvider>);
    });
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.restoreAllMocks();
    if (original) Object.defineProperty(HTMLInputElement.prototype, 'showPicker', original);
    else delete (HTMLInputElement.prototype as any).showPicker;
  });
  const open = async () => {
    await act(async () => { host.querySelector('button')!.click(); });
  };
  const install = (fn: (this: HTMLInputElement) => void) =>
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { configurable: true, value: fn });

  it('calls showPicker synchronously on the attached visible focused control and does not claim fallback', async () => {
    const picker = vi.fn(function (this: HTMLInputElement) {
      expect(this.isConnected).toBe(true);
      expect(this.hidden).toBe(false);
      expect(document.activeElement).toBe(this);
      expect(this.value).toBe('2027-12-31');
      expect(this.hasAttribute('min')).toBe(false);
    });
    install(picker);
    await open();
    expect(picker).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(error).not.toHaveBeenCalled();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(host.querySelector('input')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('button'));
  });

  it.each(['NotAllowedError', 'InvalidStateError', 'SecurityError', 'NotSupportedError'])('explains %s and retains a keyboard-accessible native fallback', async name => {
    install(() => { throw new DOMException('Known browser limitation', name); });
    await open();
    const control = host.querySelector('input')!;
    expect(control.type).toBe('date');
    expect(control.tabIndex).toBe(0);
    expect(document.activeElement).toBe(control);
    expect(document.getElementById(control.getAttribute('aria-describedby')!)?.getAttribute('role')).toBe('status');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('could not open automatically');
    expect(error).not.toHaveBeenCalled();
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(host.querySelector('input')).toBeNull();
  });

  it('reports unexpected failures instead of silently falling back', async () => {
    const failure = new Error('unexpected picker failure');
    install(() => { throw failure; });
    await open();
    expect(error).toHaveBeenCalledWith(failure);
    expect(host.querySelector('input')).toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it('clears through the existing empty-date behavior and restores button focus', async () => {
    install(() => {});
    await open();
    await act(async () => {
      const input = host.querySelector('input')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(change).toHaveBeenCalledWith('');
    expect(host.querySelector('input')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('button'));
  });

  it('dismisses on keyboard focus leaving the chooser', async () => {
    install(() => {});
    await open();
    await act(async () => { host.querySelector('input')!.blur(); });
    expect(host.querySelector('input')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });

  it('does not unmount the input when a native popup takes document focus', async () => {
    install(() => {});
    await open();
    vi.mocked(document.hasFocus).mockReturnValue(false);
    await act(async () => { host.querySelector('input')!.blur(); });
    expect(host.querySelector('input')).not.toBeNull();
    expect(change).not.toHaveBeenCalled();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(host.querySelector('input')).toBeNull();
  });

  it('keeps editor defaults and unique panel/input/fallback relationships with a second customized chooser', async () => {
    install(() => { throw new DOMException('Unavailable', 'NotAllowedError'); });
    await act(async () => {
      root.render(<I18nProvider>
        <NativeDateChooser value="12/31/2027" onChange={change} onError={error} />
        <NativeDateChooser value="01/02/2028" onChange={change} onError={error}
          triggerContent={<strong>Jan 2, 2028</strong>} accessibleLabel="Jan 2, 2028"
          className="calendar-date-chooser" triggerClassName="date-strip-label" />
      </I18nProvider>);
    });
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons[0].textContent).toBe('Choose date');
    expect(buttons[0].hasAttribute('aria-label')).toBe(false);
    expect(buttons[1].getAttribute('aria-label')).toBe('Jan 2, 2028');
    expect(buttons[1].className).toBe('date-strip-label');
    expect(buttons[0].getAttribute('aria-controls')).not.toBe(buttons[1].getAttribute('aria-controls'));
    const ids: string[] = [];
    for (const [index, button] of buttons.entries()) {
      await act(async () => { button.click(); });
      const panel = document.getElementById(button.getAttribute('aria-controls')!)!;
      const control = panel.querySelector('input')!;
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(control.value).toBe(index ? '2028-01-02' : '2027-12-31');
      expect(control.getAttribute('aria-label')).toBe(index ? 'Jan 2, 2028' : 'Choose date');
      expect(document.getElementById(control.getAttribute('aria-describedby')!)?.parentElement).toBe(panel);
      ids.push(panel.id, control.id, control.getAttribute('aria-describedby')!);
    }
    expect(new Set(ids).size).toBe(ids.length);
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(host.querySelector('input')).toBeNull();
    expect(document.activeElement).toBe(buttons[1]);
  });
});
