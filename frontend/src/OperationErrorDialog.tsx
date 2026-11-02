import { useEffect, useRef } from 'react';
import { useI18n } from './i18n/i18n';

export function OperationErrorDialog({ message, onClose }: { message: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    const dialog = ref.current;
    if (!message || !dialog) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    let disposed = false;
    const keepAcknowledgementRequired = () => {
      if (disposed || !message || !dialog.isConnected || dialog.open) {
        return;
      }
      window.setTimeout(() => {
        if (!disposed && dialog.isConnected && !dialog.open) {
          dialog.showModal();
        }
      }, 0);
    };

    dialog.addEventListener('close', keepAcknowledgementRequired);
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      disposed = true;
      dialog.removeEventListener('close', keepAcknowledgementRequired);
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [message]);

  if (!message) return null;
  return (
    <dialog ref={ref} className="operation-error-dialog" role="alertdialog"
      aria-modal="true" aria-labelledby="operation-error-title" aria-describedby="operation-error-message"
      onCancel={event => event.preventDefault()}>
      <h2 id="operation-error-title">{t('errors.dialogTitle')}</h2>
      <p id="operation-error-message">{message}</p>
      <button type="button" onClick={onClose}>{t('errors.acknowledge')}</button>
    </dialog>
  );
}
