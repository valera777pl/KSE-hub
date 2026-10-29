import { useMemo, useState } from 'react';
import { ExternalLink, Hash, Lock, MessagesSquare } from 'lucide-react';
import { api, track } from '../../../api/client';
import type { SlackSummary } from '../../../types';
import { tr } from '../../../lib/i18n';
import { addDays, dayKey, hm, todayKey } from '../../../lib/time';
import { shortWhen } from '../../ui/RemindSheet';
import { haptic, openExternal } from '../../../lib/telegram';
import { useCached } from '../../../lib/cache';
import { EmptyState, ErrorState, SkeletonRows, StaleBanner } from '../../ui/States';
import { SlackChannelsSheet } from './SlackChannelsSheet';

const dayTitle = (k: string) => (k === todayKey() ? tr('Сьогодні', 'Today') : k === addDays(todayKey(), -1) ? tr('Вчора', 'Yesterday')
  : new Date(`${k}T12:00:00`).toLocaleDateString(tr('uk-UA', 'en-GB'), { weekday: 'long', day: 'numeric', month: 'long' }));

/**
 * Навчання → Slack: what was posted in the student's channels, newest first, one card per summary.
 * Every point opens the original message in Slack. Channels and the digest time — at the bottom.
 */
export function SlackFeed() {
  const q = useCached('slack-feed', () => api.get<{ summaries: SlackSummary[] }>('/slack/feed').then((r) => r.summaries));
  const [settings, setSettings] = useState(false);

  const days = useMemo(() => {
    const by = new Map<string, SlackSummary[]>();
    for (const s of q.data ?? []) {
      const k = dayKey(new Date(s.publishedAt));
      by.set(k, [...(by.get(k) ?? []), s]);
    }
    return [...by.entries()];
  }, [q.data]);

  const openSettings = () => { haptic.tap(); setSettings(true); };
  const open = (url: string) => { haptic.tap(); track('slack.open'); openExternal(url); };

  if (!q.data && q.error) return <ErrorState error={q.error} onRetry={q.refresh} />;
  return (
    <>
      {q.staleAt && <StaleBanner at={q.staleAt} error={q.error} busy={q.loading} onRetry={q.refresh} />}
      {!q.data && <SkeletonRows rows={3} />}
      {q.data && !q.data.length && (
        <div className="group">
          <EmptyState icon={MessagesSquare} title={tr('Поки нічого зі Slack', 'Nothing from Slack yet')}
            text={tr('Тут двічі на день зʼявляються короткі підсумки твоїх каналів — курсу, групи й загальних.', 'Twice a day, short summaries of your channels show up here — course, group and general ones.')}
            action={{ label: tr('Як підключити свій канал', 'How to connect your channel'), onClick: openSettings }} />
        </div>
      )}

      {days.map(([k, list]) => (
        <section key={k}>
          <h3 className="group-title cap-first">{dayTitle(k)}</h3>
          {list.map((s) => {
            const Icon = s.isPrivate ? Lock : Hash;
            const points = s.items.length ? s.items : s.summary.split('\n').filter(Boolean).map((text) => ({ text, permalink: '', kind: 'other' as const, dueAt: undefined }));
            return (
              <article key={s.id} className="group slack-card">
                <header className="slack-card__head">
                  <Icon className="slack-card__icon" strokeWidth={1.7} aria-label={s.isPrivate ? tr('Закритий канал', 'Private channel') : tr('Відкритий канал', 'Open channel')} />
                  <div className="slack-card__title">
                    <b>{s.courseCode ? (s.section ? `${s.courseCode} [${s.section}]` : s.courseCode) : s.channelName}</b>
                    {s.courseCode && <span>#{s.channelName}</span>}
                  </div>
                  <span className="slack-card__time num">{hm(new Date(s.publishedAt))}</span>
                </header>
                <ul className="slack-points">
                  {points.map((p, i) => (
                    <li key={i}>
                      {p.permalink ? (
                        <button className="slack-point press" onClick={() => open(p.permalink)}>
                          <span className="slack-point__text">{p.text}</span>
                          {p.dueAt && <span className="slack-point__due num">{p.kind === 'deadline' ? `${tr('до', 'by')} ` : ''}{shortWhen(new Date(p.dueAt))}</span>}
                          <ExternalLink className="slack-point__go" strokeWidth={1.75} aria-label={tr('Відкрити в Slack', 'Open in Slack')} />
                        </button>
                      ) : <p className="slack-point slack-point__text">{p.text}</p>}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </section>
      ))}

      {q.data && q.data.length > 0 && (
        <button className="link-btn slack-settings" onClick={openSettings}>{tr('Канали й час дайджесту', 'Channels and digest time')}</button>
      )}
      {settings && <SlackChannelsSheet onClose={() => { setSettings(false); q.refresh(); }} />}
    </>
  );
}
