import type { TabId } from '../../types';

/*
 * Tab bar icons drawn for KSE Hub (DESIGN.md → Иконки): outline 1.7 when inactive, filled when active.
 * Fills use currentColor (the tab's colour); cut-outs inside a filled shape take the bar's background.
 */

const CUT = { fill: 'var(--tabbar-bg)' };
const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** Сьогодні: a square with today's date in it */
function Today({ on, day }: { on: boolean; day: string }) {
  return on ? (
    <>
      <rect x="3" y="3.5" width="18" height="17.5" rx="4.5" fill="currentColor" />
      <text x="12" y="16.6" textAnchor="middle" fontSize="9.5" fontWeight="700" style={CUT}>{day}</text>
    </>
  ) : (
    <>
      <rect x="3.85" y="4.35" width="16.3" height="15.8" rx="3.8" {...line} />
      <text x="12" y="16.4" textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor">{day}</text>
    </>
  );
}

/** Навчання: a mortarboard */
function Study({ on }: { on: boolean }) {
  return on ? (
    <>
      <path d="M6.3 11.4v4.3c0 1.4 2.6 3 5.7 3s5.7-1.6 5.7-3v-4.3L12 14.2z" fill="currentColor" />
      <path d="M2.5 9.2L12 4.8l9.5 4.4L12 13.6z" fill="currentColor" stroke="var(--tabbar-bg)" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M21.5 9.2v5.3" {...line} />
    </>
  ) : (
    <>
      <path d="M2.5 9.2L12 4.8l9.5 4.4L12 13.6z" {...line} />
      <path d="M6.3 11.4v4.3c0 1.4 2.6 3 5.7 3s5.7-1.6 5.7-3v-4.3" {...line} />
      <path d="M21.5 9.2v5.3" {...line} />
    </>
  );
}

/** Кімнати: a door */
function Rooms({ on }: { on: boolean }) {
  return on ? (
    <>
      <path d="M6 21V4.8A1.8 1.8 0 0 1 7.8 3h8.4A1.8 1.8 0 0 1 18 4.8V21z" fill="currentColor" />
      <path d="M3.5 21h17" {...line} />
      <circle cx="14.6" cy="12.2" r="1.15" style={CUT} />
    </>
  ) : (
    <>
      <path d="M6 21V4.8A1.8 1.8 0 0 1 7.8 3h8.4A1.8 1.8 0 0 1 18 4.8V21" {...line} />
      <path d="M3.5 21h17" {...line} />
      <circle cx="14.6" cy="12.2" r="1" fill="currentColor" />
    </>
  );
}

/** Можливості: a briefcase */
function Opps({ on }: { on: boolean }) {
  return on ? (
    <>
      <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" {...line} />
      <rect x="3" y="7.5" width="18" height="12.5" rx="2.5" fill="currentColor" />
      <path d="M3 12.8h18" stroke="var(--tabbar-bg)" strokeWidth="1.4" />
    </>
  ) : (
    <>
      <rect x="3" y="7.5" width="18" height="12.5" rx="2.5" {...line} />
      <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" {...line} />
      <path d="M3 12.8h18" {...line} />
    </>
  );
}

export function TabIcon({ tab, on, day }: { tab: TabId; on: boolean; day: string }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      {tab === 'today' && <Today on={on} day={day} />}
      {tab === 'study' && <Study on={on} />}
      {tab === 'rooms' && <Rooms on={on} />}
      {tab === 'opps' && <Opps on={on} />}
    </svg>
  );
}
