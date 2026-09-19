import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMoodleStore } from '../../../stores/moodleStore';
import { useAuthStore } from '../../../stores/authStore';

export function MoodlePage() {
  const { t } = useTranslation();
  const { courses, deadlines, syncing, syncCalendar, fetchCourses, fetchDeadlines, toggleCompleted } = useMoodleStore();
  const { user } = useAuthStore();
  const [view, setView] = useState<'deadlines' | 'courses'>('deadlines');

  useEffect(() => {
    fetchCourses();
    fetchDeadlines();
  }, []);

  const formatDeadlineDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = diffHours / 24;

    if (diffMs < 0) return t('moodle.overdue');
    if (diffDays < 1) return t('moodle.dueToday');
    if (diffDays < 2) return t('moodle.dueTomorrow');
    return date.toLocaleDateString('uk', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const getDateUrgency = (dateStr: string | null) => {
    if (!dateStr) return '';
    const diffMs = new Date(dateStr).getTime() - Date.now();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffMs < 0) return 'deadline-item__date--urgent';
    if (diffDays < 2) return 'deadline-item__date--urgent';
    if (diffDays < 5) return 'deadline-item__date--soon';
    return '';
  };

  // Helper to get course direct URL on teaching.kse.org.ua
  const getCourseUrl = (course: { courseId?: string; courseName: string }) => {
    if (course.courseId && /^\d+$/.test(course.courseId)) {
      return `https://teaching.kse.org.ua/course/view.php?id=${course.courseId}`;
    }
    return `https://teaching.kse.org.ua/course/search.php?search=${encodeURIComponent(course.courseName)}`;
  };

  const [inlineUrl, setInlineUrl] = useState('');
  const [inlineLoading, setInlineLoading] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const handleInlineSync = async () => {
    if (!inlineUrl.trim()) return;
    setInlineError(null);
    setInlineLoading(true);
    try {
      await syncCalendar(inlineUrl.trim());
      // Refresh user profile
      const { fetchUser } = useAuthStore.getState();
      await fetchUser();
    } catch (err: any) {
      setInlineError(err.message || 'Помилка синхронізації');
    } finally {
      setInlineLoading(false);
    }
  };

  if (!user?.calendarUrl) {
    return (
      <div className="page">
        <h1 className="section-header__title mb-md">{t('moodle.title')}</h1>
        <div className="empty-state" style={{ padding: '16px 8px' }}>
          <div className="empty-state__icon" style={{ fontSize: '40px', marginBottom: '8px' }}>📅</div>
          <div className="empty-state__title" style={{ fontSize: '17px' }}>{t('moodle.calendarRequired')}</div>
          <div className="empty-state__text mb-md" style={{ maxWidth: '300px' }}>{t('moodle.calendarRequiredDesc')}</div>

          {/* Direct Input */}
          <div style={{ width: '100%', maxWidth: '340px', marginBottom: '16px' }}>
            {inlineError && (
              <div style={{ background: 'rgba(255, 69, 58, 0.15)', color: 'var(--danger)', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', marginBottom: '8px', textAlign: 'left' }}>
                ❌ {inlineError}
              </div>
            )}
            <input
              className="input mb-sm"
              placeholder="https://teaching.kse.org.ua/calendar/..."
              value={inlineUrl}
              onChange={(e) => setInlineUrl(e.target.value)}
            />
            <button
              className="btn btn--primary btn--full"
              onClick={handleInlineSync}
              disabled={inlineLoading || !inlineUrl.trim()}
            >
              {inlineLoading ? t('moodle.syncing') : `🔄 ${t('moodle.sync')}`}
            </button>
          </div>

          <div style={{
            textAlign: 'left',
            background: 'var(--tg-secondary-bg)',
            padding: '12px 14px',
            borderRadius: '12px',
            fontSize: '12px',
            lineHeight: '1.4',
            color: 'var(--tg-text)',
            width: '100%',
            maxWidth: '340px',
          }}>
            <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--kse-primary)' }}>
              {t('moodle.instructionStep')}
            </div>
            <div>{t('moodle.step1')}</div>
            <div>{t('moodle.step2')}</div>
            <div>{t('moodle.step3')}</div>
            <div>{t('moodle.step4')}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="section-header">
        <h1 className="section-header__title">{t('moodle.title')}</h1>
        <button
          className="btn btn--secondary btn--small"
          onClick={() => syncCalendar()}
          disabled={syncing}
        >
          {syncing ? t('moodle.syncing') : `🔄 ${t('moodle.sync')}`}
        </button>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${view === 'deadlines' ? 'tab--active' : ''}`}
          onClick={() => setView('deadlines')}
        >
          🎯 {t('moodle.deadlines')}
        </button>
        <button
          className={`tab ${view === 'courses' ? 'tab--active' : ''}`}
          onClick={() => setView('courses')}
        >
          📖 {t('moodle.courses')}
        </button>
      </div>

      {/* Deadlines View */}
      {view === 'deadlines' && (
        <div>
          {deadlines.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">🎉</div>
              <div className="empty-state__title">{t('moodle.noDeadlines')}</div>
              <div className="empty-state__text">{t('moodle.noDeadlinesDesc')}</div>
            </div>
          ) : (
            deadlines.map(({ assignment, courseName }) => (
              <div key={assignment.id} className="deadline-item">
                <button
                  className={`deadline-item__check ${
                    assignment.isCompleted ? 'deadline-item__check--done' : ''
                  }`}
                  onClick={() => toggleCompleted(assignment.id)}
                >
                  {assignment.isCompleted && '✓'}
                </button>

                <div className="deadline-item__info">
                  <div
                    className={`deadline-item__title ${
                      assignment.isCompleted ? 'deadline-item__title--done' : ''
                    }`}
                  >
                    {assignment.title}
                  </div>
                  <div className="deadline-item__course">
                    <span className={`badge badge--${assignment.type}`}>
                      {t(`moodle.${assignment.type}`)}
                    </span>
                    {courseName && <span style={{ marginLeft: '8px' }}>{courseName}</span>}
                  </div>
                </div>

                <div className={`deadline-item__date ${getDateUrgency(assignment.dueDate)}`}>
                  {formatDeadlineDate(assignment.dueDate)}
                  {assignment.sourceUrl && (
                    <div style={{ marginTop: '4px' }}>
                      <a
                        href={assignment.sourceUrl}
                        target="_blank"
                        rel="noopener"
                        className="text-sm font-semibold"
                        style={{ color: 'var(--tg-link)', textDecoration: 'none' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Moodle ↗
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Courses View */}
      {view === 'courses' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {courses.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">📖</div>
              <div className="empty-state__title">{t('moodle.noCourses')}</div>
              <div className="empty-state__text">{t('moodle.noCoursesDesc')}</div>
            </div>
          ) : (
            courses.map((course) => (
              <div key={course.id} className="card" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                  <div>
                    <div className="font-semibold" style={{ fontSize: '15px', color: 'var(--tg-text)' }}>
                      📘 {course.courseName}
                    </div>
                    {course.syncedAt && (
                      <div className="text-sm text-hint" style={{ marginTop: '6px' }}>
                        {t('moodle.lastSync', {
                          time: new Date(course.syncedAt).toLocaleTimeString('uk', {
                            hour: '2-digit',
                            minute: '2-digit',
                          }),
                        })}
                      </div>
                    )}
                  </div>
                  <a
                    href={getCourseUrl(course)}
                    target="_blank"
                    rel="noopener"
                    className="btn btn--secondary btn--small"
                    style={{ whiteSpace: 'nowrap', textDecoration: 'none' }}
                  >
                    {t('moodle.openCourse')} ↗
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
