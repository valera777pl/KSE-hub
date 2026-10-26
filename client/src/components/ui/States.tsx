import type { LucideIcon } from 'lucide-react';

/** One sentence on why it's empty and at most one thing to do about it. */
export function EmptyState({ icon: Icon, title, text, action }: {
  icon: LucideIcon; title: string; text?: string; action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="empty">
      <Icon strokeWidth={1.75} />
      <b>{title}</b>
      {text && <p>{text}</p>}
      {action && <button className="link-btn" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

/** Grey placeholders shaped like the rows that are about to load. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="group" aria-busy="true" aria-label="Завантаження">
      {Array.from({ length: rows }, (_, i) => (
        <div className="class" key={i}>
          <div><div className="skel" style={{ height: 14, width: 40 }} /><div className="skel" style={{ height: 12, width: 34, marginTop: 6 }} /></div>
          <div><div className="skel" style={{ height: 14, width: '45%' }} /><div className="skel" style={{ height: 12, width: '70%', marginTop: 6 }} /></div>
        </div>
      ))}
    </div>
  );
}
