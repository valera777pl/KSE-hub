import { useEffect, useState } from 'react';
import { Hash, Lock } from 'lucide-react';
import { api, errorText, track } from '../../../api/client';
import type { SlackChannelSub, SlackSlot, SlackSubscriptions } from '../../../types';
import { tr } from '../../../lib/i18n';
import { haptic } from '../../../lib/telegram';
import { Sheet } from '../../ui/Sheet';

/** The Slack account the student adds to their channel; one place to rename it (PLAN.md → S1) */
export const READER_NAME = 'KSE Hub Digest';

const SLOTS: { key: 'morning' | 'evening' | 'both'; label: () => string; slots: SlackSlot[] }[] = [
  { key: 'morning', label: () => tr('Ранок 09:00', 'Morning 09:00'), slots: ['morning'] },
  { key: 'evening', label: () => tr('Вечір 20:00', 'Evening 20:00'), slots: ['evening'] },
  { key: 'both', label: () => tr('Обидва', 'Both'), slots: ['morning', 'evening'] },
];
const slotKey = (slots: SlackSlot[]) => (slots.length === 2 ? 'both' : slots[0] === 'morning' ? 'morning' : 'evening');

/** "MATH111 [P6]", "BE · вступ 2026", else the channel itself */
/** The # is the icon next to it, so the name goes without one */
export function channelTitle(c: Pick<SlackChannelSub, 'name' | 'courseCode' | 'section' | 'program' | 'cohortYear'>) {
  if (c.courseCode) return c.section ? `${c.courseCode} [${c.section}]` : c.courseCode;
  if (c.cohortYear) return `${c.program ?? tr('Потік', 'Cohort')} · ${tr('вступ', 'class of')} ${c.cohortYear}`;
  return c.name;
}

/** Profile → «Slack-канали», also from the Slack feed: when the digest comes, which channels, how to add your own. */
export function SlackChannelsSheet({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<SlackSubscriptions | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<SlackSubscriptions>('/slack/subscriptions').then(setData).catch((e) => setError(errorText(e)));
  }, []);

  // Saved on tap, like the rest of the profile; on failure the switch goes back
  const save = async (patch: { slots?: SlackSlot[]; channels?: { channelId: string; on: boolean }[] }, undo: SlackSubscriptions) => {
    setError(null);
    try {
      setData(await api.put<SlackSubscriptions>('/slack/subscriptions', patch));
    } catch (e) {
      haptic.error();
      setData(undo);
      setError(errorText(e));
    }
  };
  const pickSlot = (slots: SlackSlot[]) => {
    if (!data || slotKey(slots) === slotKey(data.slots)) return;
    haptic.select();
    track('slack.slot', { slot: slotKey(slots) });
    const undo = data;
    setData({ ...data, slots });
    save({ slots }, undo);
  };
  const toggle = (c: SlackChannelSub, on: boolean) => {
    if (!data) return;
    haptic.select();
    track('slack.subscribe', { on, private: c.isPrivate });
    const undo = data;
    setData({ ...data, channels: data.channels.map((x) => (x.channelId === c.channelId ? { ...x, on } : x)) });
    save({ channels: [{ channelId: c.channelId, on }] }, undo);
  };

  const mine = data?.channels.filter((c) => c.isPrivate) ?? [];
  const open = data?.channels.filter((c) => !c.isPrivate) ?? [];

  return (
    <Sheet onClose={onClose} label={tr('Slack-канали', 'Slack channels')}>
      <div className="sheet__title">{tr('Slack-канали', 'Slack channels')}</div>
      <div className="sheet__sub">{tr('Коротко, що писали в каналах, — окремим повідомленням у боті.', 'What was posted in your channels, in short — a separate message in the bot.')}</div>

      <div className="caption">{tr('Коли надсилати', 'When to send')}</div>
      <div className="seg seg--value" role="group" aria-label={tr('Коли надсилати', 'When to send')}>
        {SLOTS.map((s) => (
          <button key={s.key} className="num" aria-pressed={!!data && slotKey(data.slots) === s.key} disabled={!data} onClick={() => pickSlot(s.slots)}>{s.label()}</button>
        ))}
      </div>

      {!data && !error && <div className="group" aria-busy="true"><div className="row"><div className="skel" style={{ height: 16, width: '60%' }} /></div><div className="row"><div className="skel" style={{ height: 16, width: '45%' }} /></div></div>}

      {data && mine.length > 0 && (
        <>
          <div className="caption">{tr('Мої канали', 'My channels')}</div>
          <div className="group">
            {mine.map((c) => <ChannelRow key={c.channelId} c={c} onToggle={(on) => toggle(c, on)} />)}
          </div>
        </>
      )}
      {data && open.length > 0 && (
        <>
          <div className="caption">{tr('Відкриті канали', 'Open channels')}</div>
          <div className="group">
            {open.map((c) => <ChannelRow key={c.channelId} c={c} onToggle={(on) => toggle(c, on)} />)}
          </div>
        </>
      )}
      {error && <p className="note" style={{ color: 'var(--danger)' }}>{error}</p>}

      <ConnectGuide noOwn={!!data && !mine.length} />
    </Sheet>
  );
}

function ChannelRow({ c, onToggle }: { c: SlackChannelSub; onToggle: (on: boolean) => void }) {
  const Icon = c.isPrivate ? Lock : Hash;
  const title = channelTitle(c);
  return (
    <div className="row slack-ch">
      <Icon className="row-icon" strokeWidth={1.7} aria-hidden />
      <div className="row__main">
        <div className="row__title clamp2" style={{ fontWeight: 500 }}>{title}</div>
        {title !== c.name && (
          // «ваша група» first: a long channel name is the part that may be cut
          <div className="row__meta slack-ch__name">{tr('ваша група', 'your group')} · #{c.name}</div>
        )}
      </div>
      <button className="switch" role="switch" aria-checked={c.on} aria-label={title} onClick={() => onToggle(!c.on)} />
    </div>
  );
}

/** «Як підключити свій канал»: three steps with the reader account's name (SLACK-DIGEST-PROMPT.md §7.3) */
export function ConnectGuide({ noOwn }: { noOwn?: boolean }) {
  return (
    <>
      <div className="caption">{tr('Як підключити свій канал', 'How to connect your channel')}</div>
      {noOwn && <p className="note slack-guide__lead">{tr('Каналу твого курсу тут ще немає — додай його сам, це хвилина.', 'Your course channel isn\'t here yet — add it yourself, it takes a minute.')}</p>}
      <ol className="group slack-guide">
        <li>{tr('Відкрий у Slack канал свого курсу чи групи', 'Open your course or group channel in Slack')}</li>
        <li>{tr('Натисни на назву каналу → «Add people»', 'Tap the channel name → «Add people»')}</li>
        <li>{tr('Знайди', 'Find')} <b>{READER_NAME}</b> {tr('і додай', 'and add it')}</li>
      </ol>
      <p className="note">{tr(
        `Після найближчого дайджесту (09:00 або 20:00) канал зʼявиться у всього вашого курсу. ${READER_NAME} лише читає канал: нічого не пише і не бачить особистих повідомлень.`,
        `After the next digest (09:00 or 20:00) the channel appears for your whole course. ${READER_NAME} only reads the channel: it never posts and can't see direct messages.`,
      )}</p>
    </>
  );
}
