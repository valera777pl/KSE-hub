import { useAuthStore } from '../../stores/authStore';
import { initials } from '../../lib/place';
import { haptic } from '../../lib/telegram';
import { useUi } from '../../stores/uiStore';
import { tr } from '../../lib/i18n';

/** Screen title on the left, the student's avatar on the right — it opens the profile. */
export function ScreenHead({ title, sub }: { title: string; sub?: string }) {
  const user = useAuthStore((s) => s.user);
  const openProfile = useUi((s) => s.openProfile);
  return (
    <header className="screen-head">
      <div>
        {sub && <div className="screen-sub">{sub}</div>}
        <h1 className="screen-title">{title}</h1>
      </div>
      <button className="avatar-btn press" aria-label={tr('Профіль і налаштування', 'Profile and settings')} onClick={() => { haptic.tap(); openProfile(); }}>
        {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user?.fullName || '?')}
      </button>
    </header>
  );
}
