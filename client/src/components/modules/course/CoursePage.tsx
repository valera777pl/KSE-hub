import { useEffect, useState } from 'react';
import { Bell, BookOpen, ChevronRight, Clock, Hash, Mail } from 'lucide-react';
import { api, errorText, track } from '../../../api/client';
import type { CoursePageData, CourseMail } from '../../../types';
import { tr } from '../../../lib/i18n';
import { dayKey, dayMonth, hm, now, spanText } from '../../../lib/time';
import { classKind, shortPlace } from '../../../lib/place';
import { haptic, openExternal, useBackButton } from '../../../lib/telegram';
import { useUi } from '../../../stores/uiStore';
import { Avatar } from '../../ui/Avatar';
import { DeadlineRow } from '../../ui/DeadlineRow';
import { EmptyState, SkeletonRows } from '../../ui/States';
import { Sheet } from '../../ui/Sheet';
import { AskPanel } from '../../ui/AskPanel';
import { RemindSheet, shortWhen } from '../../ui/RemindSheet';
import { DoneToast, useDoneFlow } from '../../ui/doneFlow';

/**
 * One course in one place (level 2, nothing deeper): my sections, the next class, my group's deadlines,
 * the Slack channel, friends on the course, its recent emails, and Copilot with the course as context.
 */
export function CoursePage({ code, onClose }: { code: string; onClose: () => void }) {
  const [data, setData] = useState<CoursePageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mail, setMail] = useState<CourseMail[] | null>(null);
  const [asking, setAsking] = useState(false);
  const openDeadline = useUi((s) => s.openDeadline);
  const [reload, setReload] = useState(0);
  // The same «Зроблено» as on Today and in Дедлайни
  const flow = useDoneFlow(() => setReload((n) => n + 1));

  useBackButton(onClose);
  useEffect(() => {
    api.get<CoursePageData>(`/courses/${code}`).then(setData).catch((e) => setError(errorText(e)));
  }, [code, reload]);
  useEffect(() => {
    track('course.open');
    // Searched in Gmail on the spot, nothing is kept: a moment later than the rest
    api.get<{ emails: CourseMail[] }>(`/courses/${code}/mail`).then((r) => setMail(r.emails)).catch(() => setMail([]));
  }, [code]);

  // Opened from a class: that class on top; otherwise the next one
  const focus = useUi((s) => s.courseFocus);
  const next = focus ?? data?.nextClass ?? null;
  const t = now().getTime();
  const live = !!next && new Date(next.startAt).getTime() <= t && t < new Date(next.endAt).getTime();
  const past = !!next && new Date(next.endAt).getTime() <= t;
  const [reminding, setReminding] = useState(false);
  const sections = data?.sections.map((s) => `[${s}]`).join(' · ');

  return (
    <div className="page-over course" role="dialog" aria-label={code}>
      <div className="screen" style={{ paddingTop: 16 }}>
        <h1 className="screen-title">{code}</h1>
        {(data?.title || sections) && <p className="course__sub">{[data?.title, sections].filter(Boolean).join(' · ')}</p>}

        {error && <EmptyState icon={BookOpen} title={tr('Не вдалося відкрити курс', "Couldn't open the course")} text={error} />}
        {!data && !error && <div style={{ marginTop: 24 }}><SkeletonRows rows={3} /></div>}

        {data && (
          <>
            {next && (
              <>
                <div className="section-head"><h2>{live ? tr('Зараз', 'Now') : focus ? tr('Ця пара', 'This class') : tr('Наступна пара', 'Next class')}</h2></div>
                <div className="group">
                  <div className="course__next">
                    <div className="course__big num">
                      {live ? tr(`ще ${spanText(new Date(next.endAt).getTime() - t)}`, `${spanText(new Date(next.endAt).getTime() - t)} left`)
                        : past ? `${hm(next.startAt)}–${hm(next.endAt)}`
                        : tr(`через ${spanText(new Date(next.startAt).getTime() - t)}`, `in ${spanText(new Date(next.startAt).getTime() - t)}`)}
                    </div>
                    <div className="row__meta num">
                      {[shortWhen(new Date(next.startAt)), next.section && `[${next.section}] ${classKind(next.section) ?? ''}`.trim(), shortPlace(next.location)].filter(Boolean).join(' · ')}
                    </div>
                    {live && <div className="progress"><i style={{ width: `${((t - new Date(next.startAt).getTime()) / (new Date(next.endAt).getTime() - new Date(next.startAt).getTime())) * 100}%` }} /></div>}
                  </div>
                  {!past && !live && (
                    <button className="row press" onClick={() => { haptic.tap(); setReminding(true); }}>
                      <Bell className="row-icon" strokeWidth={1.7} />
                      <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>{tr('Нагадати…', 'Remind me…')}</div></div>
                      <ChevronRight className="chev" />
                    </button>
                  )}
                </div>
              </>
            )}

            <div className="section-head"><h2>{tr('Дедлайни', 'Deadlines')}</h2></div>
            {data.deadlines.length ? (
              <div className="group">
                {/* Still to do first, handed in last */}
                {[...flow.apply(data.deadlines)!].sort((x, y) => Number(x.assignment.isCompleted) - Number(y.assignment.isCompleted)).map((d) => (
                  <DeadlineRow key={d.assignment.id} d={d} onOpen={() => { onClose(); openDeadline(d.assignment.id); }} phase={flow.phaseOf(d.assignment.id)}
                    onCheck={(via) => (d.assignment.isCompleted ? flow.set(d.assignment.id, false) : flow.complete(d.assignment.id, via))} />
                ))}
              </div>
            ) : <div className="group"><p className="group-note">{tr('Своїй групі нічого здавати.', 'Nothing due for your group.')}</p></div>}

            {(data.slack || data.officeHours) && (
              <div className="group" style={{ marginTop: 22 }}>
                {data.slack && (
                  <button className="row press" onClick={() => { track('course.slack_open'); openExternal(data.slack!.url); }}>
                    <Hash className="row-icon" strokeWidth={1.7} />
                    <div className="row__main">
                      <div className="row__title" style={{ fontWeight: 500 }}>{tr('Відкрити канал у Slack', 'Open the Slack channel')}</div>
                      {data.slack.name && <div className="row__meta">#{data.slack.name}</div>}
                    </div>
                  </button>
                )}
                {data.officeHours && (
                  <div className="row">
                    <Clock className="row-icon" strokeWidth={1.7} />
                    <div className="row__main"><div className="row__title" style={{ fontWeight: 500 }}>Office hours</div><div className="row__meta">{data.officeHours}</div></div>
                  </div>
                )}
              </div>
            )}

            {data.friends.length > 0 && (
              <>
                <div className="section-head"><h2>{tr('Друзі на курсі', 'Friends on this course')}</h2></div>
                <div className="group">
                  {data.friends.map((f) => (
                    <div className="row" key={f.userId}>
                      <Avatar name={f.name} url={f.avatarUrl} size={32} />
                      <div className="row__main">
                        <div className="row__title" style={{ fontWeight: 500 }}>{f.name}</div>
                        {f.sameSection && <div className="row__meta">{tr('У твоїй групі', 'In your section')}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {mail && mail.length > 0 && (
              <>
                <div className="section-head"><h2>{tr('Листи про курс', 'Emails about it')}</h2></div>
                <div className="group">
                  {mail.map((m) => (
                    <button className="row press" key={m.id} onClick={() => openExternal(m.url)}>
                      <Mail className="row-icon" strokeWidth={1.7} />
                      <div className="row__main">
                        <div className="row__title clamp2" style={{ fontWeight: 500 }}>{m.subject}</div>
                        <div className="row__meta">{m.from} · {dayMonth(dayKey(new Date(m.receivedAt)))}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            <button className="btn-plain press" style={{ marginTop: 24 }} onClick={() => { haptic.tap(); setAsking(true); }}>{tr('Запитати Copilot', 'Ask Copilot')}</button>
          </>
        )}
      </div>

      <DoneToast flow={flow} />
      {reminding && next && (
        <RemindSheet text={`${next.courseCode}${next.section ? ` [${next.section}]` : ''} — ${shortWhen(new Date(next.startAt))}${shortPlace(next.location) ? ` · ${shortPlace(next.location)}` : ''}`}
          at={new Date(next.startAt)} startapp={`course_${next.courseCode}`} onClose={() => setReminding(false)} />
      )}
      {asking && data && (
        <Sheet onClose={() => setAsking(false)} label="Copilot">
          <AskPanel about={code} onBack={() => setAsking(false)}
            context={`${tr('курс', 'course')} ${code}${data.title ? ` ${data.title}` : ''}${sections ? `, ${tr('мої групи', 'my sections')} ${sections}` : ''}`}
            starters={[tr('Що мені здати з цього курсу?', 'What do I have to hand in for this course?'), tr('Коли наступна пара і де?', 'When and where is the next class?')]} />
        </Sheet>
      )}
    </div>
  );
}
