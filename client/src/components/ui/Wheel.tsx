import { useEffect, useRef } from 'react';
import { haptic } from '../../lib/telegram';

const ROW = 44;
const VISIBLE = 5;

/**
 * iOS-style picker wheel: scroll, it snaps to the centre row. Arrow keys move one step.
 * `values` are what gets picked, `label` how each one reads.
 */
export function Wheel<T>({ values, value, onChange, label, ariaLabel }: {
  values: T[]; value: T; onChange: (v: T) => void; label: (v: T) => string; ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const index = Math.max(0, values.indexOf(value));
  const last = useRef(index);
  const settle = useRef<number | undefined>(undefined);

  // Keep the wheel on the selected value when it changes from outside (or on first paint)
  useEffect(() => {
    const el = ref.current;
    if (el && Math.round(el.scrollTop / ROW) !== index) el.scrollTo({ top: index * ROW });
    last.current = index;
  }, [index, values.length]);

  const onScroll = () => {
    const el = ref.current!;
    const i = Math.min(values.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)));
    if (i !== last.current) {
      last.current = i;
      haptic.select();
      window.clearTimeout(settle.current);
      settle.current = window.setTimeout(() => onChange(values[i]), 60);
    }
  };

  const step = (d: number) => {
    const i = Math.min(values.length - 1, Math.max(0, index + d));
    ref.current?.scrollTo({ top: i * ROW, behavior: 'smooth' });
  };

  return (
    <div className="wheel" style={{ height: ROW * VISIBLE }}>
      <div className="wheel__band" aria-hidden="true" />
      <div
        ref={ref}
        className="wheel__list"
        onScroll={onScroll}
        tabIndex={0}
        role="slider"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={values.length - 1}
        aria-valuenow={index}
        aria-valuetext={label(value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
          if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
        }}
      >
        {values.map((v, i) => (
          <div key={i} className={`wheel__item${i === index ? ' wheel__item--on' : ''}`} onClick={() => ref.current?.scrollTo({ top: i * ROW, behavior: 'smooth' })}>
            {label(v)}
          </div>
        ))}
      </div>
    </div>
  );
}
