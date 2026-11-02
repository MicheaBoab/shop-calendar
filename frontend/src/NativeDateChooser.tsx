import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { formatDateForUsInput, parseUsDateInput } from './appointment-time';
import { useI18n } from './i18n/i18n';

// Keep the native control visible and focusable while its picker is in use.
// No UTC conversion: both manual and native input represent the shop's local date.
export function NativeDateChooser({ value, onChange, onError, triggerContent, accessibleLabel, className, triggerClassName }: {
  value: string;
  onChange: (value: string) => void;
  onError: (error: unknown) => void;
  triggerContent?: ReactNode;
  accessibleLabel?: string;
  className?: string;
  triggerClassName?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  const panelId = `${id}-date-panel`;
  const inputId = `${id}-native-date`;
  const fallbackId = `${id}-date-fallback`;
  const [open, setOpen] = useState(false);
  const [fallback, setFallback] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const parsed = parseUsDateInput(value);
  const nativeValue = parsed
    ? `${String(parsed.getFullYear()).padStart(4, '0')}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
    : '';
  const close = () => { setOpen(false); button.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); button.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const choose = () => {
    if (open) { close(); return; }
    // Commit before showPicker, still synchronously inside the user's click.
    flushSync(() => { setOpen(true); setFallback(false); });
    const control = input.current!;
    control.focus();
    if (typeof control.showPicker !== 'function') { setFallback(true); return; }
    try {
      control.showPicker();
    } catch (error) {
      if (error instanceof DOMException &&
          ['NotAllowedError', 'InvalidStateError', 'SecurityError', 'NotSupportedError'].includes(error.name)) {
        setFallback(true);
      } else {
        close();
        onError(error);
      }
    }
  };

  return <div className={['native-date-chooser', className].filter(Boolean).join(' ')} ref={host}
    onBlur={(event) => {
      // A browser/OS picker can temporarily take document focus without moving
      // focus to another page control. Do not unmount its owning input then.
      if (!event.relatedTarget && !document.hasFocus()) return;
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
    <button ref={button} type="button" onClick={choose} className={triggerClassName}
      aria-label={accessibleLabel}
      aria-expanded={open} aria-controls={panelId}>{triggerContent ?? t('editor.chooseDate')}</button>
    {open && <div className="native-date-panel" id={panelId}>
      <input ref={input} id={inputId} type="date"
        aria-label={accessibleLabel ?? t('editor.chooseDate')} aria-describedby={fallback ? fallbackId : undefined}
        value={nativeValue}
        onChange={(event) => {
          const iso = event.currentTarget.value;
          const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
          const local = date ? parseUsDateInput(`${date[2]}/${date[3]}/${date[1]}`) : null;
          onChange(local ? formatDateForUsInput(local) : '');
          close();
        }} />
      {fallback && <span id={fallbackId} className="hint" role="status">{t('editor.datePickerFallback')}</span>}
    </div>}
  </div>;
}
