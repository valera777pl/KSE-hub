import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, BarChart3 } from 'lucide-react';
import { applyTheme } from '../../lib/telegram';
import { hideSplash } from '../../lib/splash';
import { EmptyState } from '../ui/States';
import { Glow } from '../ui/Glow';
import { AdminSlack } from './AdminSlack';

/**
 * Admin dashboard at /admin, a lazy chunk students never download. Opened from the bot's /admin link
 * (token in the URL hash, kept in localStorage) or from inside Telegram by an admin.
 * Each block opens with one sentence that answers its question, the chart below backs it up.
 * Owner-only screen, so the copy is Ukrainian only.
 */

type Analytics = {
  days: number;
  today: string;
  pulse: {
    dau: number; wau: number; active: number; newToday: number; users: number; onboarded: number;
    activation: { eligible: number; activated: number; rate: number };
    daily: { day: string; active: number; newUsers: number }[];
  };
  funnel: { key: string; users: number; pct: number; dropped: number }[];
  retention: { week: string; size: number; d1: number | null; d7: number | null; d14: number | null; d30: number | null }[];
  features: { key: string; users: number; prev: number; share: number; trend: number; dead: boolean }[];
  pushes: { type: string; sent: number; opened: number; ctr: number }[];
  ai: {
    daily: { day: string; messages: number }[];
    messages: number; perActive: number; limitHits: number; errors: number;
    tools: { name: string; times: number }[];
    topics: { topic: string; times: number }[];
  };
  friends: { requests: number; accepted: number; invitesSent: number; inviters: number; joined: number; inviteRate: number; avgFriends: number | null };
  health: { key: string; value: number; total: number; alert: boolean }[];
};

const TOKEN_KEY = 'kse_admin_token';
const API = import.meta.env.VITE_API_URL || '/api';
const PERIODS = [7, 14, 30] as const;
const ACTIVATION_GOAL = 35;

const FUNNEL_LABELS: Record<string, string> = {
  start: 'Нові', auth: 'Вхід через пошту', schedule: 'Розклад', program: 'Програма', digest: 'Дайджест', moodle: 'Moodle', done: 'Готово',
};
const FEATURE_LABELS: Record<string, string> = {
  'tab.today': 'Сьогодні', 'tab.schedule': 'Розклад', 'tab.deadlines': 'Дедлайни', 'tab.rooms': 'Кімнати',
  'tab.forYou': 'Можливості', 'tab.startups': 'Стартапи', 'tab.people': 'Люди', 'tab.profile': 'Профіль',
  'ai.message': 'Copilot', 'booking.created': 'Бронювання', 'deadline.sheet_open': 'Відкрили дедлайн',
  'deadline.done': 'Позначили зробленим', 'deadline.moodle_open': 'Перейшли в Moodle',
  'schedule.friend_added': 'Додали друга в розклад', 'opp.apply_click': 'Подали на можливість', 'opp.saved': 'Зберегли можливість',
  'friend.request': 'Запит у друзі', 'invite.sent': 'Запросили друга', 'reminder.created': 'Поставили нагадування',
  'deadline.feedback_open': 'Відкрили відгук', 'tab.events': 'Події', 'event.open': 'Відкрили подію', 'event.remind': 'Нагадати за день',
  'pinned.set': 'Закріплене в чаті', 'course.open': 'Сторінка курсу',
};
const PUSH_LABELS: Record<string, string> = {
  digest: 'Дайджест', weekly: 'Дедлайни на тиждень', d24: 'Дедлайн за 24 год', d3: 'Дедлайн за 3 год',
  change: 'Зміни в розкладі', soon: 'Пара через 15 хв', urgent: 'Терміновий лист', opp: 'Подача закінчується',
  booking_end: 'Бронь закінчується', onboarding: 'Готово після реєстрації', remind: 'Нагадування', friend: 'Друзі', event: 'Події', slack: 'Slack-дайджест',
};
// Pushes without a button can't be "opened"
const NO_BUTTON = new Set(['soon', 'urgent']);
const TOOL_LABELS: Record<string, string> = {
  get_available_rooms: 'Вільні кімнати', book_room: 'Бронювання', hot_book_room: 'Hot Booking', get_booking_quota: 'Квота бронювань',
  get_my_bookings: 'Мої броні', get_my_schedule: 'Мій розклад', compare_schedule: 'Спільні пари', find_free_classmates: 'Хто вільний',
  get_my_deadlines: 'Дедлайни', search_my_emails: 'Пошук у листах', search_opportunities: 'Стажування',
  search_kse_info: 'База знань KSE', search_startups: 'Стартапи', create_reminder: 'Нагадування', get_slack_summaries: 'Slack-підсумки',
};
const TOPIC_LABELS: Record<string, string> = {
  schedule: 'Розклад', deadlines: 'Дедлайни', rooms: 'Кімнати', mail: 'Пошта', kse: 'KSE-інфо',
  startups: 'Стартапи', opportunities: 'Можливості', reminders: 'Нагадування', other: 'Інше',
};
const HEALTH_LABELS: Record<string, string> = {
  mail_revoked: 'Відкликали доступ до пошти', no_schedule: 'Без розкладу', no_moodle: 'Без Moodle',
  digest_failed: 'Дайджест не доставлено', bot_blocked: 'Заблокували бота',
};

function authHeader(): string | null {
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (fromHash) {
    try { localStorage.setItem(TOKEN_KEY, fromHash); } catch { /* private mode */ }
    history.replaceState(null, '', window.location.pathname + window.location.search); // keep the token out of the address bar
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

const num = (n: number) => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 }).format(n);
const day = (iso: string) => new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
const longDay = (iso: string) => new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
/** 1 студент · 2 студенти · 5 студентів */
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

type View = 'analytics' | 'slack';
const VIEW_KEY = 'kse_admin_view';

export function AdminPage() {
  const [view, setView] = useState<View>(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'slack' ? 'slack' : 'analytics'; } catch { return 'analytics'; }
  });
  const [slackSub, setSlackSub] = useState('Чернетки й канали');
  const [days, setDays] = useState<(typeof PERIODS)[number]>(7);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auth] = useState(authHeader);

  useEffect(() => { applyTheme(); hideSplash(); }, []);

  const pick = (v: View) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage blocked */ }
  };

  useEffect(() => {
    if (!auth) { setError('Відкрий посилання, яке надсилає бот на /admin.'); return; }
    let live = true;
    setError(null);
    fetch(`${API}/admin/analytics?days=${days}`, { headers: { Authorization: auth } })
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) throw new Error('Посилання недійсне або застаріло — надішли боту /admin ще раз.');
        if (!r.ok) throw new Error('Сервер не відповів. Спробуй оновити сторінку.');
        return r.json() as Promise<Analytics>;
      })
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message.startsWith('Посилання') || e.message.startsWith('Сервер') ? e.message : 'Немає звʼязку з сервером.'));
    return () => { live = false; };
  }, [auth, days]);

  return (
    <div className="shell"><main className="shell__main"><div className="screen adm has-glow">
      <Glow />
      <header className="screen-head">
        <div>
          <p className="screen-sub">{view === 'slack' ? slackSub : data ? `${longDay(data.today)} · за ${days} днів` : 'Адмінка'}</p>
          {/* The two titles are the switch, as in «Навчання» */}
          <div className="title-tabs" role="tablist">
            {([['analytics', 'Аналітика'], ['slack', 'Slack']] as const).map(([id, label]) => (
              <button key={id} id={`tab-${id}`} role="tab" className="screen-title title-tab" aria-selected={view === id}
                aria-controls={`panel-${id}`} onClick={() => pick(id)}>{label}</button>
            ))}
          </div>
        </div>
      </header>

      {view === 'slack' ? (
        <div role="tabpanel" id="panel-slack" aria-labelledby="tab-slack" className="fade-in">
          {auth ? <AdminSlack auth={auth} onCount={setSlackSub} /> : <EmptyState icon={AlertCircle} title="Не вдалося завантажити" text="Відкрий посилання, яке надсилає бот на /admin." />}
        </div>
      ) : (
        <div role="tabpanel" id="panel-analytics" aria-labelledby="tab-analytics" className="fade-in">
          <div className="seg" role="group" aria-label="Період">
            {PERIODS.map((p) => <button key={p} aria-pressed={p === days} onClick={() => setDays(p)}>{p} днів</button>)}
          </div>

          {error && !data && <EmptyState icon={AlertCircle} title="Не вдалося завантажити" text={error} />}
          {!error && !data && <Skeleton />}
          {data && (data.pulse.users === 0
            ? <EmptyState icon={BarChart3} title="Поки ніхто не зареєструвався" text="Цифри зʼявляться після першого /start у боті." />
            : <Dashboard d={data} />)}
        </div>
      )}
    </div></main></div>
  );
}

function Dashboard({ d }: { d: Analytics }) {
  const { pulse, ai, friends } = d;
  return (
    <>
      <Block kicker="Пульс" headline={pulseHeadline(d)}>
        <div className="adm-tiles">
          <Tile label="Сьогодні" value={pulse.dau} sub="активних" />
          <Tile label="За тиждень" value={pulse.wau} sub={`з ${pulse.onboarded} зареєстрованих`} />
          <Tile label="Нові сьогодні" value={pulse.newToday} sub={`усього ${pulse.users}`} />
          <Tile label="Активація" value={`${pulse.activation.rate}%`} sub={`ціль ${ACTIVATION_GOAL}% · ${pulse.activation.activated} з ${pulse.activation.eligible}`}
            alert={pulse.activation.eligible > 0 && pulse.activation.rate < ACTIVATION_GOAL} />
        </div>
        <Card title="Активні по днях" note="відкрили мініапп або написали боту">
          <Line points={pulse.daily.map((p) => ({ day: p.day, value: p.active }))} unit="активних" />
        </Card>
      </Block>

      <Block kicker="Онбординг" headline={funnelHeadline(d)}>
        <Card title={`Нові за ${d.days} днів`} note="від першого входу до «Готово»">
          <Bars rows={d.funnel.map((s, i) => ({
            key: s.key, label: FUNNEL_LABELS[s.key] ?? s.key, value: s.users,
            right: `${s.users} · ${s.pct}%`,
            note: i > 0 && s.dropped > 0 ? `−${s.dropped}` : undefined,
          }))} max={d.funnel[0]?.users} />
        </Card>
      </Block>

      <Block kicker="Утримання" headline={retentionHeadline(d)}>
        <Card title="Когорти за тижнем реєстрації" note="% тих, хто повернувся">
          <Heat cohorts={d.retention} />
        </Card>
      </Block>

      <Block kicker="Функції" headline={featuresHeadline(d)}>
        <Card title="Унікальні студенти" note={`% від ${pulse.active} активних · стрілка — до попередніх ${d.days} днів`}>
          <Bars rows={d.features.map((f) => ({
            key: f.key, label: FEATURE_LABELS[f.key] ?? f.key, value: f.users, muted: f.dead,
            right: `${f.users} · ${f.share}%`, trend: f.trend, tag: f.dead ? 'мертва' : undefined,
          }))} />
        </Card>
      </Block>

      <Block kicker="Пуші" headline={pushHeadline(d)}>
        {d.pushes.length ? (
          <Card title="Надіслано → відкрито">
            <Bars rows={d.pushes.map((p) => ({
              key: p.type, label: PUSH_LABELS[p.type] ?? p.type, value: p.sent,
              right: NO_BUTTON.has(p.type) ? `${p.sent} · без кнопки` : `${p.sent} → ${p.opened} · ${p.ctr}%`,
            }))} />
          </Card>
        ) : <Card title="Надіслано → відкрито"><p className="adm-none">Пушів за період не було</p></Card>}
      </Block>

      <Block kicker="Бот і ІІ" headline={aiHeadline(d)}>
        <div className="adm-tiles">
          <Tile label="Уперлись у ліміт" value={ai.limitHits} sub={`${plural(ai.limitHits, 'раз', 'рази', 'разів')} за ${d.days} днів`} alert={ai.limitHits > 0} />
          <Tile label="Помилки ІІ" value={ai.errors} sub={`${plural(ai.errors, 'раз', 'рази', 'разів')} за ${d.days} днів`} alert={ai.errors > 0} />
        </div>
        <Card title="Повідомлення по днях"><Line points={ai.daily.map((p) => ({ day: p.day, value: p.messages }))} unit="повідомлень" /></Card>
        <Card title="Теми питань" note="сирі тексти не зберігаємо">
          {ai.topics.length
            ? <Bars rows={ai.topics.map((t) => ({ key: t.topic, label: TOPIC_LABELS[t.topic] ?? t.topic, value: t.times, right: String(t.times) }))} />
            : <p className="adm-none">Питань ще не було</p>}
        </Card>
        <Card title="Що робив ІІ">
          {ai.tools.length
            ? <Bars rows={ai.tools.map((t) => ({ key: t.name, label: TOOL_LABELS[t.name] ?? t.name, value: t.times, right: String(t.times) }))} />
            : <p className="adm-none">Інструментів ще не викликав</p>}
        </Card>
      </Block>

      <Block kicker="Друзі й ріст" headline={friendsHeadline(d)}>
        <div className="adm-tiles">
          <Tile label="Запити дружби" value={friends.requests} sub={`прийнято ${friends.accepted}`} />
          <Tile label="Запрошення" value={friends.invitesSent} sub={`від ${friends.inviters} ${plural(friends.inviters, 'людини', 'людей', 'людей')}`} />
          <Tile label="Прийшли" value={friends.joined} sub={`за запрошенням · ${num(friends.inviteRate)} на 1`} />
          <Tile label="Друзів у середньому" value={friends.avgFriends === null ? '—' : num(friends.avgFriends)} sub="взаємних" />
        </div>
      </Block>

      <Block kicker="Здоровʼя" headline={healthHeadline(d)}>
        <div className="group">
          {d.health.map((h) => (
            <div className="row adm-health" key={h.key}>
              <div className="row__main"><div className="adm-health__label">{HEALTH_LABELS[h.key] ?? h.key}</div></div>
              {h.alert && <AlertCircle className="adm-alert-icon" aria-label="Вище норми" />}
              <span className={`adm-health__value${h.alert ? ' adm-health__value--alert' : ''}`}>
                {h.value}{h.key !== 'digest_failed' && <span className="adm-health__total"> з {h.total}</span>}
              </span>
            </div>
          ))}
        </div>
      </Block>
    </>
  );
}

/* ─── Headlines: one sentence that answers each block's question ─── */

function pulseHeadline({ pulse }: Analytics) {
  if (!pulse.wau) return 'За тиждень ніхто не відкривав KSE Hub';
  return `${pulse.wau} ${plural(pulse.wau, 'студент користувався', 'студенти користувались', 'студентів користувались')} KSE Hub за тиждень, сьогодні — ${pulse.dau}`;
}

function funnelHeadline({ funnel, days }: Analytics) {
  if (!funnel[0]?.users) return `За ${days} днів нових не було`;
  const worst = funnel.slice(1).reduce((a, b) => (b.dropped > a.dropped ? b : a), funnel[1]);
  if (!worst || worst.dropped === 0) return `Усі ${funnel[0].users} нових дійшли до кінця`;
  return `Найбільше відпадають на кроці «${FUNNEL_LABELS[worst.key]}»: −${worst.dropped}`;
}

function retentionHeadline({ retention }: Analytics) {
  const known = retention.filter((c) => c.d1 !== null);
  if (!known.length) return 'Ще рано: потрібен хоча б день після реєстрації';
  const size = known.reduce((s, c) => s + c.size, 0);
  const d1 = Math.round(known.reduce((s, c) => s + (c.d1 ?? 0) * c.size, 0) / size);
  return `Наступного дня повертаються ${d1}%`;
}

function featuresHeadline({ features }: Analytics) {
  const alive = features.filter((f) => f.users > 0);
  const dead = features.filter((f) => f.dead).length;
  if (!alive.length) return 'Функціями ще ніхто не користувався';
  const top = alive[0];
  return `«${FEATURE_LABELS[top.key] ?? top.key}» відкрили ${top.share}% активних · мертвих функцій: ${dead}`;
}

function pushHeadline({ pushes }: Analytics) {
  const clickable = pushes.filter((p) => !NO_BUTTON.has(p.type) && p.sent > 0);
  if (!clickable.length) return pushes.length ? 'Пуші з кнопкою ще не надсилались' : 'Пушів за період не було';
  const sent = clickable.reduce((s, p) => s + p.sent, 0);
  const opened = clickable.reduce((s, p) => s + p.opened, 0);
  const best = [...clickable].sort((a, b) => b.ctr - a.ctr)[0];
  return `Пуші відкривають у ${Math.round((opened / sent) * 100)}% випадків, найчастіше — «${PUSH_LABELS[best.type] ?? best.type}»`;
}

function aiHeadline({ ai }: Analytics) {
  if (!ai.messages) return 'Copilot за період ніхто не питав';
  return `${ai.messages} ${plural(ai.messages, 'питання', 'питання', 'питань')} до Copilot, ${num(ai.perActive)} на активного`;
}

function friendsHeadline({ friends }: Analytics) {
  if (!friends.invitesSent && !friends.requests) return 'Друзів і запрошень поки немає';
  if (!friends.joined) return `${friends.invitesSent} ${plural(friends.invitesSent, 'запрошення', 'запрошення', 'запрошень')}, ще ніхто не прийшов`;
  return `За запрошеннями прийшли ${friends.joined}, по ${num(friends.inviteRate)} на того, хто запрошує`;
}

function healthHeadline({ health }: Analytics) {
  const bad = health.filter((h) => h.alert);
  if (!bad.length) return 'Усе гаразд';
  return `Перевір: ${bad.map((h) => (HEALTH_LABELS[h.key] ?? h.key).toLowerCase()).join(', ')}`;
}

/* ─── Building blocks ─── */

function Block({ kicker, headline, children }: { kicker: string; headline: string; children: ReactNode }) {
  return (
    <section className="adm-block">
      <p className="adm-kicker">{kicker}</p>
      <h2 className="adm-headline">{headline}</h2>
      {children}
    </section>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="group adm-card">
      <div className="adm-card__head">
        <b>{title}</b>
        {note && <span>{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Tile({ label, value, sub, alert }: { label: string; value: number | string; sub?: string; alert?: boolean }) {
  return (
    <div className="adm-tile">
      <span className="adm-tile__label">{label}</span>
      <b className={`adm-tile__value${alert ? ' adm-tile__value--alert' : ''}`}>{value}</b>
      {sub && <span className="adm-tile__sub">{sub}</span>}
    </div>
  );
}

type BarRow = { key: string; label: string; value: number; right: string; note?: string; muted?: boolean; trend?: number; tag?: string };

/** Horizontal bars: label and value above, a thin bar from one baseline; dead features in grey. */
function Bars({ rows, max }: { rows: BarRow[]; max?: number }) {
  const top = Math.max(1, max ?? 0, ...rows.map((r) => r.value));
  return (
    <ul className="adm-bars">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="adm-bars__line">
            <span className="adm-bars__label">
              {r.label}
              {r.tag && <em className="adm-tag">{r.tag}</em>}
            </span>
            <span className="adm-bars__value">
              {r.note && <span className="adm-bars__note">{r.note}</span>}
              {r.trend !== undefined && r.trend !== 0 && (
                r.trend > 0
                  ? <ArrowUp className="adm-trend" aria-label={`більше на ${r.trend}`} />
                  : <ArrowDown className="adm-trend" aria-label={`менше на ${-r.trend}`} />
              )}
              {r.right}
            </span>
          </div>
          <div className={`adm-bar${r.muted ? ' adm-bar--muted' : ''}`} style={{ width: r.value ? `max(4px, ${(r.value / top) * 100}%)` : 0 }} />
        </li>
      ))}
    </ul>
  );
}

/** Axis top with a whole-number middle tick: 9 → 10, 31 → 40, 3 → 4. */
function niceMax(n: number) {
  if (n <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(n));
  const top = [1, 2, 4, 5, 10].map((k) => k * step).find((v) => v >= n) ?? 10 * step;
  return top;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Single-series line: 2px line over a 10% wash, end value labelled, crosshair + tooltip on hover/touch, table below. */
function Line({ points, unit }: { points: { day: string; value: number }[]; unit: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 132;
  const PAD = { top: 12, right: 28, bottom: 22, left: 26 };
  const top = niceMax(Math.max(...points.map((p) => p.value), 0));
  const w = Math.max(0, width - PAD.left - PAD.right);
  const h = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length > 1 ? (i / (points.length - 1)) * w : w / 2);
  const y = (v: number) => PAD.top + h - (v / top) * h;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = points.length ? `${path} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : '';
  const last = points.length - 1;

  const pick = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || points.length < 2) return;
    const i = Math.round(((clientX - box.left - PAD.left) / w) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };
  const shown = hover ?? null;

  return (
    <div className="adm-line" ref={ref}
      onPointerMove={(e) => pick(e.clientX)} onPointerDown={(e) => pick(e.clientX)} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={`${unit} по днях`}>
          {[0, top / 2, top].map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={PAD.left + w} y1={y(v)} y2={y(v)} className="adm-grid" />
              <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="adm-axis">{num(v)}</text>
            </g>
          ))}
          <text x={x(0)} y={H - 4} className="adm-axis">{day(points[0].day)}</text>
          <text x={x(last)} y={H - 4} textAnchor="end" className="adm-axis">{day(points[last].day)}</text>
          <path d={area} className="adm-area" />
          <path d={path} className="adm-path" />
          {shown === null && (
            <>
              <circle cx={x(last)} cy={y(points[last].value)} r={4} className="adm-dot" />
              <text x={x(last) + 8} y={y(points[last].value)} dy="0.32em" className="adm-endlabel">{points[last].value}</text>
            </>
          )}
          {shown !== null && (
            <>
              <line x1={x(shown)} x2={x(shown)} y1={PAD.top} y2={PAD.top + h} className="adm-cross" />
              <circle cx={x(shown)} cy={y(points[shown].value)} r={4} className="adm-dot" />
            </>
          )}
        </svg>
      )}
      {shown !== null && (
        <div className="adm-tip" style={{ left: Math.min(Math.max(x(shown), 60), width - 60) }}>
          <span>{day(points[shown].day)}</span>
          <b>{points[shown].value} {unit}</b>
        </div>
      )}
      <details className="adm-table">
        <summary>Таблиця</summary>
        <table>
          <tbody>
            {[...points].reverse().map((p) => <tr key={p.day}><td>{day(p.day)}</td><td>{p.value}</td></tr>)}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Retention heat table: one blue, darker = more came back; empty cells are windows not reached yet. */
function Heat({ cohorts }: { cohorts: Analytics['retention'] }) {
  if (!cohorts.length) return <p className="adm-none">Поки ніхто не завершив реєстрацію</p>;
  const cols = ['d1', 'd7', 'd14', 'd30'] as const;
  return (
    <table className="adm-heat">
      <thead>
        <tr><th>Тиждень</th><th>Людей</th>{cols.map((c) => <th key={c}>{c.toUpperCase()}</th>)}</tr>
      </thead>
      <tbody>
        {cohorts.map((c) => (
          <tr key={c.week}>
            <td>з {day(c.week)}</td>
            <td>{c.size}</td>
            {cols.map((k) => {
              const v = c[k];
              return (
                <td key={k}>
                  {v === null
                    ? <span className="adm-heat__empty" aria-label="ще рано">·</span>
                    : <span className="adm-heat__cell" style={{ '--v': `${Math.max(v, 6)}%` } as React.CSSProperties} data-dark={v >= 50 || undefined}>{v}%</span>}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Завантаження">
      <div className="skel" style={{ height: 22, width: '80%', margin: '24px 0 12px' }} />
      <div className="adm-tiles">{[0, 1, 2, 3].map((i) => <div key={i} className="adm-tile"><div className="skel" style={{ height: 40 }} /></div>)}</div>
      <div className="group adm-card"><div className="skel" style={{ height: 132 }} /></div>
    </div>
  );
}
