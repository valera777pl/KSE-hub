import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBackButton } from '../../lib/telegram';

/** Bottom sheet: slides up over a dimmed screen; Telegram's Back closes it. */
export function Sheet({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useBackButton(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>
        <div className="sheet__grip" />
        {children}
      </div>
    </>,
    document.body,
  );
}
