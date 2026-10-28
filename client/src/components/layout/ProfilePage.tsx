import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { api, errorText } from '../../api/client';
import { clearCache } from '../../lib/cache';
import { useAuthStore } from '../../stores/authStore';
import type { ClassEvent, DigestSource, GoogleStatus, User } from '../../types';
import { tr, useLang, type Lang } from '../../lib/i18n';
import { cohortFromEmail, courseYear, programName, programsFromSchedule } from '../../lib/programs';
import { initials } from '../../lib/place';
import { addDays, mondayOf, todayKey } from '../../lib/time';
import { getThemePref, haptic, openExternal, setThemePref, tg, useBackButton, type ThemePref } from '../../lib/telegram';
import { Sheet } from '../ui/Sheet';
import { MoodleConnectForm } from '../modules/deadlines/MoodleConnect';
import { FriendsGroup } from './FriendsGroup';
import { RemindersGroup } from './RemindersGroup';

const digestLabel = (h: number) => (h < 0 ? tr('Не надсилати', "Don't send") : `${String(h).padStart(2, '0')}:00`);

function confirm(text: string): Promise<boolean> {
  const app = tg() as unknown as { showConfirm?: (t: string, cb: (ok: boolean) => void) => void } | null;
  if (app?.showConfirm) return new Promise((resolve) => app.showConfirm!(text, resolve));
  return Promise.resolve(window.confirm(text));
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="switch" role="switch" aria-checked={on} aria-label={label} onClick={() => { haptic.select(); onChange(!on); }} />;
}

function Row({ title, sub, children, onClick }: { title: string; sub?: string; children?: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <div className="row__main">
        <div className="row__title" style={{ fontWeight: 500 }}>{title}</div>
        {sub && <div className="row__meta">{sub}</div>}
      </div>
      {children}
    </>
  );
  return onClick ? <button className="row press" onClick={onClick}>{body}</button> : <div className="row">{body}</div>;
}

type Pick = { title: string; options: { key: string; label: string; sub?: string }[]; value: string; onPick: (key: string) => void; note?: string };

/** Профіль: everything the bot and the app do for the student, as iOS-style groups. Changes save on tap. */
export function ProfilePage({ onClose }: { onClose: () => void }) {
  const { user, updateUser } = useAuthStore();
  const setLang = useLang((s) => s.setLang);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [programs, setPrograms] = useState<string[]>([]);
  const [pick, setPick] = useState<Pick | null>(null);
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const [moodle, setMoodle] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBackButton(onClose);

  useEffect(() => {
    api.get<GoogleStatus>('/google/status').then(setGoogle).catch(() => setGoogle(null));
    const mon = mondayOf(todayKey());
    Promise.all([mon, addDays(mon, 7)].map((m) => api.get<{ events: ClassEvent[] }>(`/schedule/week?start=${m}`).catch(() => ({ events: [] as ClassEvent[] }))))
      .then((w) => setPrograms(programsFromSchedule(w.flatMap((x) => x.events))));
  }, []);

  if (!user) return null;

  const save = async (patch: Partial<User>) => {
    setError(null);
    try { await updateUser(patch); } catch (e) { haptic.error(); setError(errorText(e)); }
  };

  const toggleSource = (s: DigestSource, on: boolean) =>
    save({ digestSources: on ? [...new Set([...user.digestSources, s])] : user.digestSources.filter((x) => x !== s) });

  const cohort = cohortFromEmail(google?.email);
  const mailOk = !!google?.connected && !google.needsReconnect;
  const programOptions = [...new Set([...programs, ...(user.faculty ? [user.faculty] : [])])];

  const connectMail = async () => {
    const { url } = await api.get<{ url: string }>('/google/connect');
    openExternal(url);
  };
  const disconnectMail = async () => {
    if (!(await confirm(tr('Відключити пошту? Розклад і листи перестануть оновлюватись.', 'Disconnect your mail? Schedule and mail stop updating.')))) return;
    await api.delete('/google');
    setGoogle(await api.get<GoogleStatus>('/google/status').catch(() => null));
  };
  const deleteData = async () => {
    const ok = await confirm(tr(
      'Видалити всі твої дані з KSE Hub? Пошта, Moodle, листи, дедлайни, історія чату й профіль у «Можливостях» зникнуть назавжди.',
      'Delete all your data from KSE Hub? Mail, Moodle, letters, deadlines, chat history and your Opportunities profile will be gone for good.',
    ));
    if (!ok) return;
    await api.delete('/users/me');
    clearCache();
    const app = tg() as unknown as { close?: () => void } | null;
    if (app?.close) app.close(); else location.reload();
  };

  const changeLang = (l: Lang) => {
    if (l === user.languagePref) return;
    haptic.select();
    setLang(l);
    save({ languagePref: l });
  };

  return (
    <div className="page-over" role="dialog" aria-label={tr('Профіль', 'Profile')}>
      <div className="screen" style={{ paddingTop: 16 }}>
        <div className="me">
          <span className="avatar-btn">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.fullName || '?')}</span>
          <b>{user.fullName}</b>
          <span>{[google?.email, cohort && tr(`вступ ${cohort} · ${courseYear(cohort)} курс`, `class of ${cohort} · year ${courseYear(cohort)}`)].filter(Boolean).join('\n')}</span>
        </div>
        {error && <p className="note" style={{ color: 'var(--danger)', textAlign: 'center' }}>{error}</p>}

        <div className="caption">{tr('Навчання', 'Study')}</div>
        <div className="group">
          <Row title={tr('Програма', 'Programme')}
            sub={programOptions.length === 0 ? tr('Візьмемо з назв курсів, коли підтягнеться розклад', "We'll take it from course titles once your schedule arrives") : undefined}
            onClick={programOptions.length ? () => setPick({
              title: tr('Твоя програма', 'Your programme'),
              note: tr('Лише програми з назв твоїх курсів.', 'Only programmes from your course titles.'),
              options: programOptions.map((c) => ({ key: c, label: programName(c), sub: programName(c) !== c ? c : undefined })),
              value: user.faculty ?? '',
              onPick: (c) => save({ faculty: c }),
            }) : undefined}>
            {user.faculty ? <span className="row__value">{user.faculty}</span> : programOptions.length > 0 && <span className="row__value" style={{ color: 'var(--accent)' }}>{tr('Обрати', 'Choose')}</span>}
            {programOptions.length > 0 && <ChevronRight className="chev" strokeWidth={1.75} />}
          </Row>
          <Row title={tr('Грант чи контракт', 'Grant or contract')} onClick={() => setPick({
            title: tr('Як ти навчаєшся?', 'How is your study funded?'),
            note: tr('Щоб показувати гранти й можливості саме для тебе.', 'So we show the grants and opportunities that apply to you.'),
            options: [{ key: 'grant', label: tr('Грант', 'Grant') }, { key: 'contract', label: tr('Контракт', 'Contract') }],
            value: user.studentType,
            onPick: (k) => save({ studentType: k as User['studentType'] }),
          })}>
            <span className="row__value">{user.studentType === 'grant' ? tr('Грант', 'Grant') : tr('Контракт', 'Contract')}</span>
            <ChevronRight className="chev" strokeWidth={1.75} />
          </Row>
        </div>

        <FriendsGroup confirm={confirm} />
        <RemindersGroup confirm={confirm} />

        <div className="caption">{tr('Дайджест у боті', 'Digest in the bot')}</div>
        <div className="group">
          <Row title={tr('Коли надсилати', 'When to send')} onClick={() => setPick({
            title: tr('Коли надсилати дайджест?', 'When should the digest arrive?'),
            options: [8, 13, 20, -1].map((h) => ({ key: String(h), label: digestLabel(h) })),
            value: String(user.digestHour),
            onPick: (k) => save({ digestHour: Number(k) }),
          })}>
            <span className="row__value num">{digestLabel(user.digestHour)}</span>
            <ChevronRight className="chev" strokeWidth={1.75} />
          </Row>
          <Row title="Moodle" sub={tr('Дедлайни на 3 дні', 'Deadlines for 3 days')}><Toggle label="Moodle" on={user.digestSources.includes('moodle')} onChange={(v) => toggleSource('moodle', v)} /></Row>
          <Row title={tr('Пошта', 'Mail')} sub={tr('Важливі листи коротко', 'Important mail in short')}><Toggle label={tr('Пошта', 'Mail')} on={user.digestSources.includes('gmail')} onChange={(v) => toggleSource('gmail', v)} /></Row>
          <Row title="Slack" sub={tr('Лише листи-сповіщення від Slack', 'Only Slack notification emails')}><Toggle label="Slack" on={user.digestSources.includes('slack')} onChange={(v) => toggleSource('slack', v)} /></Row>
        </div>
        <p className="note">{tr('Нагадування про дедлайни (за 24 і за 3 год) і термінові листи приходять одразу.', 'Deadline reminders (24 and 3 h before) and urgent mail arrive right away.')}</p>

        <div className="caption">{tr('Сповіщення про пари', 'Class alerts')}</div>
        <div className="group">
          <Row title={tr('Пару перенесли чи скасували', 'Class moved or cancelled')}><Toggle label={tr('Пару перенесли', 'Class moved')} on={user.notifyScheduleChanges} onChange={(v) => save({ notifyScheduleChanges: v })} /></Row>
          <Row title={tr('Пара через 15 хвилин', 'Class in 15 minutes')} sub={tr('З аудиторією', 'With the room')}><Toggle label={tr('Пара через 15 хвилин', 'Class in 15 minutes')} on={user.classReminders} onChange={(v) => save({ classReminders: v })} /></Row>
        </div>

        <div className="caption">{tr('Розклад', 'Schedule')}</div>
        <div className="group">
          <Row title={tr('Видно одногрупникам', 'Visible to classmates')} sub={tr('Тебе знайдуть за прізвищем і побачать спільні пари', 'Classmates can find you by surname and see shared classes')}>
            <Toggle label={tr('Видно одногрупникам', 'Visible to classmates')} on={user.scheduleVisible} onChange={(v) => save({ scheduleVisible: v })} />
          </Row>
        </div>

        <div className="caption">{tr('Підключення', 'Connections')}</div>
        <div className="group">
          <Row title={tr('Пошта KSE', 'KSE mail')} sub={mailOk ? google!.email ?? undefined : google?.needsReconnect ? tr('Google відкликав доступ', 'Google revoked access') : tr('Не підключено', 'Not connected')}>
            {mailOk
              ? <button className="link-btn" style={{ color: 'var(--danger)' }} onClick={disconnectMail}>{tr('Відключити', 'Disconnect')}</button>
              : <button className="link-btn" onClick={connectMail}>{tr('Підключити', 'Connect')}</button>}
          </Row>
          <Row title="Moodle" sub={user.calendarUrl ? tr('Дедлайни підтягуються', 'Deadlines are syncing') : tr('Не підключено', 'Not connected')} onClick={() => setMoodle(true)}>
            <span className="row__value">{user.calendarUrl ? tr('Змінити', 'Change') : tr('Підключити', 'Connect')}</span>
            <ChevronRight className="chev" strokeWidth={1.75} />
          </Row>
        </div>

        <div className="caption">{tr('Тема', 'Theme')}</div>
        <div className="seg" role="group" aria-label={tr('Тема', 'Theme')} style={{ marginBottom: 0 }}>
          {([['auto', tr('Як у Telegram', 'Like Telegram')], ['light', tr('Світла', 'Light')], ['dark', tr('Темна', 'Dark')]] as [ThemePref, string][]).map(([k, label]) => (
            <button key={k} aria-pressed={theme === k} onClick={() => { if (k === theme) return; haptic.select(); setThemePref(k); setTheme(k); }}>{label}</button>
          ))}
        </div>

        <div className="caption">{tr('Мова', 'Language')}</div>
        <div className="group">
          {([['uk', 'Українська'], ['en', 'English']] as [Lang, string][]).map(([l, label]) => (
            <button key={l} className="row press check-row" role="radio" aria-checked={user.languagePref === l} onClick={() => changeLang(l)}>
              <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{label}</div></div>
              {user.languagePref === l && <Check className="tick" strokeWidth={2.25} />}
            </button>
          ))}
        </div>

        <div className="group" style={{ marginTop: 32 }}>
          <button className="row press row--danger" onClick={deleteData}>{tr('Видалити мої дані з KSE Hub', 'Delete my data from KSE Hub')}</button>
        </div>
        <p className="note">{tr(
          'Тексти листів не зберігаємо — лише тему й короткий зміст для дайджесту. Розмови з Copilot видаляємо через тиждень.',
          'We never store email bodies — only the subject and a short summary for the digest. Copilot chats are deleted after a week.')}</p>
      </div>

      {pick && (
        <Sheet onClose={() => setPick(null)} label={pick.title}>
          <div className="sheet__title">{pick.title}</div>
          {pick.note && <div className="sheet__sub">{pick.note}</div>}
          <div className="options" role="radiogroup" style={{ marginTop: 16 }}>
            {pick.options.map((o) => (
              <button key={o.key} className="option press" role="radio" aria-checked={pick.value === o.key}
                onClick={() => { haptic.select(); pick.onPick(o.key); setPick({ ...pick, value: o.key }); setTimeout(() => setPick(null), 200); }}>
                <span className="option__main">
                  <span className="option__title" style={{ display: 'block' }}>{o.label}</span>
                  {o.sub && <span className="option__sub" style={{ display: 'block' }}>{o.sub}</span>}
                </span>
                <Check strokeWidth={2.25} />
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {moodle && (
        <Sheet onClose={() => setMoodle(false)} label={tr('Дедлайни з Moodle', 'Deadlines from Moodle')}>
          <div className="sheet__title">{tr('Дедлайни з Moodle', 'Deadlines from Moodle')}</div>
          <div className="sheet__sub" style={{ marginBottom: 16 }}>{tr('Три кроки в Moodle — і нагадування приходитимуть самі.', 'Three steps in Moodle, and reminders come on their own.')}</div>
          <MoodleConnectForm onSaved={() => setMoodle(false)} />
        </Sheet>
      )}
    </div>
  );
}
