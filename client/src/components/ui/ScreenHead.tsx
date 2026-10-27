import { useAuthStore } from '../../stores/authStore';
import { initials } from '../../lib/place';
import { haptic } from '../../lib/telegram';
import { useUi } from '../../stores/uiStore';
import { tr } from '../../lib/i18n';

type Tab<T extends string> = { id: T; label: string };

/**
 * Screen title on the left, the student's avatar on the right — it opens the profile.
 * With `tabs`, the title itself is the switch: sections as big titles side by side, the open one in full colour.
 */
export function ScreenHead<T extends string>({ title, sub, note, tabs, active, onTab }: {
  title?: string; sub?: string; note?: string; tabs?: Tab<T>[]; active?: T; onTab?: (id: T) => void;
}) {
  const user = useAuthStore((s) => s.user);
  const openProfile = useUi((s) => s.openProfile);
  return (
    <header className="screen-head">
      <div>
        {sub && <div className="screen-sub">{sub}</div>}
        {tabs ? (
          <div className="title-tabs" role="tablist" onKeyDown={(e) => {
            // Arrow keys move between the titles, like any tab list
            const i = tabs.findIndex((t) => t.id === active);
            const next = e.key === 'ArrowRight' ? tabs[i + 1] : e.key === 'ArrowLeft' ? tabs[i - 1] : undefined;
            if (!next) return;
            e.preventDefault();
            haptic.select();
            onTab?.(next.id);
            document.getElementById(`tab-${next.id}`)?.focus();
          }}>
            {tabs.map((t) => (
              <button key={t.id} id={`tab-${t.id}`} role="tab" className="screen-title title-tab" aria-selected={t.id === active} tabIndex={t.id === active ? 0 : -1}
                aria-controls={`panel-${t.id}`} onClick={() => { if (t.id !== active) { haptic.select(); onTab?.(t.id); } }}>
                {t.label}
              </button>
            ))}
          </div>
        ) : (
          <h1 className="screen-title">{title}</h1>
        )}
        {note && <div className="screen-note num">{note}</div>}
      </div>
      <button className="avatar-btn press" aria-label={tr('Профіль і налаштування', 'Profile and settings')} onClick={() => { haptic.tap(); openProfile(); }}>
        {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user?.fullName || '?')}
      </button>
    </header>
  );
}
