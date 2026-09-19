import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { useMoodleStore } from '../../stores/moodleStore';

interface ProfileDrawerProps {
  onClose: () => void;
}

export function ProfileDrawer({ onClose }: ProfileDrawerProps) {
  const { t, i18n } = useTranslation();
  const { user, updateUser } = useAuthStore();
  const { syncCalendar } = useMoodleStore();
  const [formData, setFormData] = useState({
    fullName: user?.fullName || '',
    faculty: user?.faculty || '',
    year: user?.year || 1,
    studentType: user?.studentType || 'contract',
    languagePref: user?.languagePref || 'uk',
    calendarUrl: user?.calendarUrl || '',
  });

  useEffect(() => {
    if (user) {
      setFormData((prev) => ({
        fullName: prev.fullName || user.fullName || '',
        faculty: prev.faculty || user.faculty || '',
        year: user.year || prev.year || 1,
        studentType: user.studentType || prev.studentType || 'contract',
        languagePref: user.languagePref || prev.languagePref || 'uk',
        calendarUrl: prev.calendarUrl || user.calendarUrl || '',
      }));
    }
  }, [user]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSave = async () => {
    setErrorMessage(null);
    try {
      setSaving(true);
      await updateUser(formData as any);
      i18n.changeLanguage(formData.languagePref);
      setSaved(true);
      if (formData.calendarUrl) {
        // Auto-sync calendar when URL saved
        await syncCalendar(formData.calendarUrl);
      }
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Помилка збереження');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" style={{ paddingBottom: 'calc(var(--bottom-nav-height) + 40px)' }}>
        <div className="drawer__header">
          <h2 className="drawer__title">{t('profile.title')}</h2>
          <button className="btn btn--ghost btn--small" onClick={onClose}>✕</button>
        </div>

        <div className="drawer__content">
          {errorMessage && (
            <div style={{ background: 'rgba(255, 69, 58, 0.15)', color: 'var(--danger)', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' }}>
              ❌ {errorMessage}
            </div>
          )}
          {saved && (
            <div style={{ background: 'rgba(52, 211, 153, 0.15)', color: 'var(--success)', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' }}>
              ✓ {t('profile.saved')}
            </div>
          )}
          {/* Avatar */}
          <div className="profile-avatar-edit">
            <div className="profile-avatar-edit__img">
              {user?.fullName?.[0]?.toUpperCase() || '?'}
            </div>
            <span className="text-sm text-hint">@{user?.username || 'user'}</span>
          </div>

          {/* Personal Info */}
          <div className="profile-section">
            <h3 className="profile-section__title">{t('profile.displayName')}</h3>
            <input
              className="input"
              value={formData.fullName}
              onChange={(e) => handleChange('fullName', e.target.value)}
              placeholder={t('profile.displayName')}
            />
          </div>

          <div className="profile-section">
            <h3 className="profile-section__title">{t('profile.faculty')}</h3>
            <input
              className="input"
              value={formData.faculty}
              onChange={(e) => handleChange('faculty', e.target.value)}
              placeholder="Economics, Finance, Data Science..."
            />
          </div>

          <div className="profile-section" style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <h3 className="profile-section__title">{t('profile.year')}</h3>
              <select
                className="input"
                value={formData.year}
                onChange={(e) => handleChange('year', parseInt(e.target.value))}
              >
                {[1, 2, 3, 4, 5, 6].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <h3 className="profile-section__title">{t('profile.studentType')}</h3>
              <select
                className="input"
                value={formData.studentType}
                onChange={(e) => handleChange('studentType', e.target.value)}
              >
                <option value="grant">{t('profile.grant')}</option>
                <option value="contract">{t('profile.contract')}</option>
              </select>
            </div>
          </div>

          <div className="profile-section">
            <h3 className="profile-section__title">{t('profile.language')}</h3>
            <div className="tabs">
              {['uk', 'en'].map((lang) => (
                <button
                  key={lang}
                  className={`tab ${formData.languagePref === lang ? 'tab--active' : ''}`}
                  onClick={() => handleChange('languagePref', lang)}
                >
                  {lang === 'uk' ? '🇺🇦 Українська' : '🇬🇧 English'}
                </button>
              ))}
            </div>
          </div>

          {/* Moodle Calendar Integration */}
          <div className="profile-section">
            <h3 className="profile-section__title">📅 {t('profile.integrations')}</h3>

            <div className="input-group">
              <label className="input-group__label">{t('profile.calendarUrl')}</label>
              <input
                className="input"
                value={formData.calendarUrl}
                onChange={(e) => handleChange('calendarUrl', e.target.value)}
                placeholder="https://teaching.kse.org.ua/calendar/export_execute.php?..."
              />
              <div style={{ marginTop: '8px', padding: '10px 12px', background: 'var(--tg-secondary-bg)', borderRadius: '8px', fontSize: '12px', lineHeight: '1.4', color: 'var(--tg-hint)' }}>
                <strong>{t('moodle.instructionStep')}</strong><br/>
                {t('moodle.step1')}<br/>
                {t('moodle.step2')}<br/>
                {t('moodle.step3')}<br/>
                {t('moodle.step4')}
              </div>
            </div>
          </div>

          {/* Save Button */}
          <button
            className="btn btn--primary btn--full"
            onClick={handleSave}
            disabled={saving}
            style={{ marginTop: '16px' }}
          >
            {saving ? '...' : saved ? `✓ ${t('profile.saved')}` : t('profile.save')}
          </button>
        </div>
      </aside>
    </>
  );
}
