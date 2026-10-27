import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDrag } from '@use-gesture/react';
import { useBackButton } from '../../lib/telegram';

/** Pulled down this far, or flicked down this fast, the sheet goes away. */
const CLOSE_DISTANCE = 100;
const CLOSE_VELOCITY = 0.5;

/**
 * Bottom sheet: slides up over a dimmed screen. Closes on a swipe down, a tap on the dim,
 * Escape and Telegram's Back. A sheet that fits on screen follows the finger anywhere;
 * one that scrolls only by its top edge, so scrolling the content never closes it.
 */
export function Sheet({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useBackButton(onClose);
  const ref = useRef<HTMLDivElement>(null);
  const [y, setY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [scrolls, setScrolls] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  // Does the content overflow? Then dragging the body is scrolling, not closing
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollHeight > el.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const leave = () => {
    setLeaving(true);
    setY(ref.current?.offsetHeight ?? 600);
    setTimeout(onClose, 200);
  };

  const bind = useDrag(({ active, movement: [, my], velocity: [, vy], direction: [, dy], cancel, first }) => {
    if (first && (ref.current?.scrollTop ?? 0) > 0) { cancel(); return; }
    if (active) { setDragging(true); setY(Math.max(0, my)); return; }
    setDragging(false);
    if (my > CLOSE_DISTANCE || (vy > CLOSE_VELOCITY && dy > 0 && my > 20)) leave();
    else setY(0);
  }, { axis: 'y', filterTaps: true });

  const height = ref.current?.offsetHeight ?? 600;
  const dim = 1 - Math.min(1, y / height);

  return createPortal(
    <>
      <div className="sheet-backdrop" style={{ opacity: dim, transition: dragging ? 'none' : 'opacity 200ms var(--ease)' }} onClick={leave} />
      <div ref={ref} className={`sheet${scrolls ? '' : ' sheet--fits'}`} role="dialog" aria-modal="true" aria-label={label}
        {...(scrolls ? {} : bind())}
        style={{ transform: y ? `translateY(${y}px)` : undefined, transition: dragging ? 'none' : leaving || y ? 'transform 200ms var(--ease)' : undefined }}>
        <div className="sheet__handle" {...(scrolls ? bind() : {})}><div className="sheet__grip" /></div>
        {children}
      </div>
    </>,
    document.body,
  );
}
