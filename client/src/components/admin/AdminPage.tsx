import { useEffect, useState } from 'react';

/**
 * Admin dashboard at /admin. Opened from the bot's /admin link (token in the
 * URL hash, kept in localStorage) or from inside Telegram by an admin.
 */

type Stats = {
  days: number;
  totals: Record<string, number>;
  daily: { day: string; active: number; new_users: number; ai: number }[];
  features: { event: string; times: number; users: number }[];
  tools: { name: string; times: number }[];
};

const TOKEN_KEY = 'kse_admin_token';

const EVENT_LABELS: Record<string, string> = {
  'app.open': 'Відкрили мініапп',
  'tab.rooms': 'Вкладка «Кімнати»',
  'tab.schedule': 'Вкладка «Розклад»',
  'tab.moodle': 'Вкладка «Moodle»',
  'tab.venture': 'Вкладка «Метч»',
  'tab.careers': 'Вкладка «Карʼєра»',
  'tab.copilot': 'Вкладка «Copilot»',
  'bot.start': '/start у боті',
  'ai.message': 'Повідомлення ІІ',
  'ai.tool': 'ІІ викликав функцію',
  'ai.limit_hit': 'Уперлись у ліміт ІІ',
  'ai.error': 'Помилка ІІ',
  'booking.created': 'Бронювання',
  'schedule.search': 'Пошук студента',
  'schedule.compare': 'Порівняння розкладу',
  'schedule.refresh': 'Оновили розклад',
  'google.connected': 'Підключили пошту',
  'onboarding.completed': 'Завершили реєстрацію',
  'digest.sent': 'Надіслано дайджест',
  'reminder.sent': 'Нагадування про дедлайн',
  'urgent.sent': 'Терміновий лист',
};

const TOOL_LABELS: Record<string, string> = {
  get_available_rooms: 'Вільні кімнати',
  book_room: 'Бронювання',
  hot_book_room: 'Hot Booking',
  get_booking_quota: 'Квота бронювань',
  get_my_bookings: 'Мої броні',
  get_my_schedule: 'Мій розклад',
  compare_schedule: 'Спільні пари',
  find_free_classmates: 'Хто вільний',
  get_my_deadlines: 'Дедлайни',
  search_my_emails: 'Пошук у листах',
  search_opportunities: 'Стажування',
};

function authHeader(): string | null {
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (fromHash) {
    try { localStorage.setItem(TOKEN_KEY, fromHash); } catch { /* private mode */ }
    history.replaceState(null, '', window.location.pathname); // keep the token out of the address bar
    return `Admin ${fromHash}`;
  }
  try {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) return `Admin ${saved}`;
  } catch { /* storage blocked */ }
  // @ts-ignore - inside Telegram an admin is recognised by initData
  const initData = window.Telegram?.WebApp?.initData;
  return initData ? `tma ${initData}` : null;
}

const day = (iso: string) =>
  new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));

/** Single-series column chart: one hue, ≤24px columns, 4px rounded tops, hover tooltip, table fallback. */
function Columns({ title, data }: { title: string; data: { label: string; value: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const top = niceMax(max);
  return (
    <div className="card" style={{ padding: '16px', marginBottom: '12px' }}>
      <div className="font-semibold" style={{ marginBottom: '12px' }}>{title}</div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <div className="text-sm text-hint" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: 140, fontVariantNumeric: 'tabular-nums' }}>
          <span>{top}</span><span>{Math.round(top / 2)}</span><span>0</span>
        </div>
        <div style={{ flex: 1, position: 'relative', marginTop: 40 }}>
          <div className="admin-grid" style={{ top: 0 }} />
          <div className="admin-grid" style={{ top: 70 }} />
          <div className="admin-grid admin-grid--base" style={{ top: 140 }} />
          <div style={{ display: 'flex', alignItems: 'flex-end', height: 140, gap: 2, position: 'relative' }}>
            {data.map((d, i) => (
              <div
                key={d.label}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onTouchStart={() => setHover(i)}
                style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: 'default', position: 'relative' }}
              >
                <div className="admin-col" style={{ height: `${(d.value / top) * 100}%`, opacity: hover === null || hover === i ? 1 : 0.45 }} />
                {hover === i && (
                  // Edge columns pin the tooltip to their side so it never leaves the card
                  <div className="admin-tip" style={i > data.length * 0.75 ? { left: 'auto', right: 0, transform: 'none' } : i < data.length * 0.25 ? { left: 0, transform: 'none' } : undefined}>
                    <div className="text-hint">{d.label}</div>
                    <div className="font-semibold">{d.value}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="text-sm text-hint" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
            <span>{data[0]?.label}</span><span>{data[data.length - 1]?.label}</span>
          </div>
        </div>
      </div>
      <details style={{ marginTop: '8px' }}>
        <summary className="text-sm text-hint" style={{ cursor: 'pointer' }}>Таблиця</summary>
        <table className="admin-table">
          <tbody>{data.map((d) => <tr key={d.label}><td>{d.label}</td><td>{d.value}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

function niceMax(n: number): number {
  if (n <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / (pow / 2)) * (pow / 2);
}

function Tile({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="card" style={{ padding: '14px' }}>
      <div className="text-sm text-hint">{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 600 }}>{value}</div>
      {hint && <div className="text-sm text-hint">{hint}</div>}
    </div>
  );
}

/** Horizontal magnitude bars with the numbers beside them. */
function BarList({ rows }: { rows: { label: string; value: number; note?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <table className="admin-table">
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td style={{ width: '45%' }}>{r.label}</td>
            <td>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className="admin-bar" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
              </div>
            </td>
            <td className="text-hint" style={{ whiteSpace: 'nowrap' }}>{r.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AdminPage() {
  const [auth] = useState(authHeader);
  const [days, setDays] = useState(14);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    setError(null);
    fetch(`/api/admin/stats?days=${days}`, { headers: { Authorization: auth } })
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) throw new Error('Посилання недійсне або застаріло — надішли боту /admin ще раз.');
        if (!r.ok) throw new Error(`Помилка ${r.status}`);
        setStats(await r.json());
      })
      .catch((err) => setError(err.message));
  }, [auth, days]);

  if (!auth) {
    return <div className="page"><h1 className="section-header__title">Адмінка</h1><p className="text-hint">Відкрий посилання з команди /admin у боті.</p></div>;
  }

  const t = stats?.totals ?? {};
  return (
    <div className="page" style={{ maxWidth: 960, width: '100%', paddingBottom: 48 }}>
      <div className="section-header" style={{ alignItems: 'center' }}>
        <h1 className="section-header__title">KSE Hub · аналітика</h1>
        <div className="tabs" style={{ marginBottom: 0, width: 'auto' }}>
          {[7, 14, 30].map((d) => (
            <button key={d} className={`tab ${days === d ? 'tab--active' : ''}`} style={{ whiteSpace: 'nowrap' }} onClick={() => setDays(d)}>{d} дн.</button>
          ))}
        </div>
      </div>

      {error && <div className="card" style={{ padding: 14, color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}
      {!stats && !error && <p className="text-hint">Завантаження…</p>}

      {stats && (
        <>
          <div className="card" style={{ padding: '16px', marginBottom: '12px' }}>
            <div className="text-sm text-hint">Активні студенти за 7 днів</div>
            <div style={{ fontSize: '48px', fontWeight: 600, lineHeight: 1.1 }}>{t.active_7d}</div>
            <div className="text-sm text-hint">за добу — {t.active_24h} · усього в боті — {t.users}</div>
          </div>

          <div className="admin-tiles">
            <Tile label="Зареєструвались" value={t.onboarded} hint={`з ${t.users}`} />
            <Tile label="Пошта підключена" value={t.mail_connected} hint={t.mail_revoked ? `${t.mail_revoked} відкликали доступ` : undefined} />
            <Tile label="Розклад синхронізовано" value={t.schedule_synced} />
            <Tile label="Moodle підключено" value={t.moodle_connected} />
            <Tile label="Приховали розклад" value={t.schedule_hidden} />
            <Tile label="Заблокували бота" value={t.bot_blocked} />
          </div>

          <Columns title="Активні студенти по днях" data={stats.daily.map((d) => ({ label: day(d.day), value: d.active }))} />
          <Columns title="Повідомлення ІІ по днях" data={stats.daily.map((d) => ({ label: day(d.day), value: d.ai }))} />
          <Columns title="Нові студенти по днях" data={stats.daily.map((d) => ({ label: day(d.day), value: d.new_users }))} />

          <div className="card" style={{ padding: '16px', marginBottom: '12px' }}>
            <div className="font-semibold" style={{ marginBottom: '8px' }}>Що використовують · {stats.days} дн.</div>
            {stats.features.length === 0
              ? <p className="text-sm text-hint">Подій ще немає — вони записуються з цього оновлення.</p>
              : <BarList rows={stats.features.map((f) => ({ label: EVENT_LABELS[f.event] ?? f.event, value: f.times, note: `${f.users} студ.` }))} />}
          </div>

          <div className="card" style={{ padding: '16px' }}>
            <div className="font-semibold" style={{ marginBottom: '8px' }}>Що питають в ІІ · {stats.days} дн.</div>
            {stats.tools.length === 0
              ? <p className="text-sm text-hint">Ще немає даних.</p>
              : <BarList rows={stats.tools.map((x) => ({ label: TOOL_LABELS[x.name] ?? x.name, value: x.times }))} />}
          </div>
        </>
      )}
    </div>
  );
}
