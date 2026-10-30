import { useEffect, useState } from 'react';
import { ChevronDown, ClipboardList, ExternalLink, FileText, Folder, Link2, ListChecks, MessagesSquare, type LucideIcon } from 'lucide-react';
import { api, track } from '../../../api/client';
import { tr } from '../../../lib/i18n';
import { haptic, openExternal } from '../../../lib/telegram';
import { useAuthStore } from '../../../stores/authStore';
import { plural } from '../../../lib/time';

type GradeItem = { id: number; name: string; grade: string | null; percent: string | null; feedback: string | null };
type Material = { id: number; name: string; kind: string; url: string };
type MoodleCourse =
  | { connected: false }
  | { connected: true; courseId: number; name: string; url: string; grades: { total: string | null; items: GradeItem[] }; sections: { name: string; items: Material[] }[] };

/** Long gradebooks fold after this many items */
const GRADES_SHOWN = 6;

const KIND_ICON: Record<string, LucideIcon> = {
  resource: FileText, page: FileText, folder: Folder, url: Link2, assign: ClipboardList, quiz: ListChecks, forum: MessagesSquare,
};

/**
 * The course page's Moodle part (owner's test, Moodle through the student's token): the grades with the teacher's
 * feedback, and the materials section by section as the teacher laid them out. Loaded apart, so the page
 * doesn't wait for Moodle; a course Moodle doesn't know shows nothing.
 */
export function CourseMoodle({ code }: { code: string }) {
  const on = useAuthStore((s) => !!s.user?.isAdmin && !!s.user?.moodleConnected);
  const [data, setData] = useState<MoodleCourse | null | 'none' | 'error'>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!on) return;
    setData(null);
    api.get<MoodleCourse>(`/moodle/course/${code}`)
      .then(setData)
      .catch((e) => setData((e as { status?: number }).status === 404 ? 'none' : 'error'));
  }, [code, on, attempt]);

  if (!on || data === 'none' || (data && data !== 'error' && !data.connected)) return null;
  if (data === null) {
    return (
      <>
        <div className="section-head"><h2>{tr('Оцінки', 'Grades')}</h2></div>
        <div className="group" aria-busy="true"><div className="row"><div className="row__main"><div className="skel" style={{ height: 14, width: '60%' }} /><div className="skel" style={{ height: 12, width: '35%', marginTop: 6 }} /></div></div></div>
      </>
    );
  }
  if (data === 'error') {
    return (
      <div className="group" style={{ marginTop: 22 }}>
        <p className="group-note">
          {tr('Moodle не відповів.', 'Moodle didn\'t answer.')}{' '}
          <button className="link-btn" style={{ padding: 0, fontSize: 15 }} onClick={() => setAttempt((n) => n + 1)}>{tr('Спробувати ще', 'Try again')}</button>
        </p>
      </div>
    );
  }
  return (
    <>
      <Grades total={data.grades.total} items={data.grades.items} />
      <Materials sections={data.sections} courseUrl={data.url} />
    </>
  );
}

function Grades({ total, items }: { total: string | null; items: GradeItem[] }) {
  const [all, setAll] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const shown = all ? items : items.slice(0, GRADES_SHOWN);
  return (
    <>
      <div className="section-head">
        <h2>{tr('Оцінки', 'Grades')}</h2>
        {total && <span className="num">{tr('Підсумок', 'Total')} <b className="course-grade__total">{total}</b></span>}
      </div>
      <div className="group">
        {!items.length && <p className="group-note">{tr('Оцінок ще немає.', 'No grades yet.')}</p>}
        {shown.map((i) => {
          const open = openId === i.id;
          const body = (
            <>
              <div className="row__main">
                <div className={`row__title clamp2${i.grade ? '' : ' grades__none'}`} style={{ fontWeight: 500 }}>{i.name}</div>
                {i.feedback && <div className={`row__meta course-grade__feedback${open ? '' : ' clamp3'}`}>{i.feedback}</div>}
              </div>
              <span className={`row__value num course-grade__value${i.grade ? '' : ' grades__none'}`}>{i.grade ?? '—'}</span>
            </>
          );
          // Feedback longer than three lines opens in place
          return i.feedback
            ? <button key={i.id} className="row press course-grade" aria-expanded={open} onClick={() => { haptic.select(); setOpenId(open ? null : i.id); }}>{body}</button>
            : <div key={i.id} className="row course-grade">{body}</div>;
        })}
        {items.length > GRADES_SHOWN && (
          <button className="row toggle-row" aria-expanded={all} onClick={() => { haptic.select(); setAll((v) => !v); }}>
            <span className="row__main">{all ? tr('Згорнути', 'Collapse') : tr(`Показати всі ${items.length}`, `Show all ${items.length}`)}</span>
            <ChevronDown size={18} strokeWidth={1.75} />
          </button>
        )}
      </div>
    </>
  );
}

function Materials({ sections, courseUrl }: { sections: { name: string; items: Material[] }[]; courseUrl: string }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <div className="section-head"><h2>{tr('Матеріали', 'Materials')}</h2></div>
      <div className="group">
        {!sections.length && <p className="group-note">{tr('Викладач ще нічого не додав.', 'Nothing here yet.')}</p>}
        {sections.map((s, si) => (
          <div key={si} className="course-mats">
            <button className="row press" aria-expanded={open === si} onClick={() => { haptic.select(); setOpen(open === si ? null : si); }}>
              <div className="row__main">
                <div className="row__title" style={{ fontWeight: 500 }}>{s.name}</div>
                <div className="row__meta num">{tr(`${s.items.length} ${plural(s.items.length, 'матеріал', 'матеріали', 'матеріалів')}`, `${s.items.length} ${s.items.length === 1 ? 'item' : 'items'}`)}</div>
              </div>
              <ChevronDown className="chev course-mats__chev" strokeWidth={1.75} aria-hidden />
            </button>
            {open === si && s.items.map((m) => {
              const Icon = KIND_ICON[m.kind] ?? ExternalLink;
              return (
                <button key={m.id} className="row press course-mats__item" onClick={() => { track('course.material_open', { kind: m.kind }); openExternal(m.url); }}>
                  <Icon className="row-icon" strokeWidth={1.7} />
                  <div className="row__main"><div className="row__title clamp2">{m.name}</div></div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <button className="link-btn" style={{ display: 'block', margin: '8px auto 0', minHeight: 44 }} onClick={() => openExternal(courseUrl)}>{tr('Відкрити курс у Moodle', 'Open the course in Moodle')}</button>
    </>
  );
}
