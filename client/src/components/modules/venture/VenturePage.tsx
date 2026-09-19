import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useVentureStore } from '../../../stores/ventureStore';
import type { SwipeCardProfile, SwipeCardProject } from '../../../types';

export function VenturePage() {
  const { t } = useTranslation();
  const {
    deck, deckType, matchResult,
    setDeckType, fetchDeck, swipe, clearMatch, fetchMyProfile,
  } = useVentureStore();

  const [, setSwipingId] = useState<number | null>(null);
  const [swipeDir, setSwipeDir] = useState<'left' | 'right' | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchDeck();
    fetchMyProfile();
  }, []);

  const currentCard = deck[0] as SwipeCardProfile | SwipeCardProject | undefined;

  const handleSwipe = async (isLike: boolean) => {
    if (!currentCard) return;

    const targetId = 'profile' in currentCard ? currentCard.profile.id : (currentCard as SwipeCardProject).project.id;
    setSwipeDir(isLike ? 'right' : 'left');
    setSwipingId(targetId);

    try {
      // @ts-ignore
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(isLike ? 'medium' : 'light');
    } catch {}

    // Animate out then swipe
    setTimeout(async () => {
      await swipe(targetId, deckType, isLike);
      setSwipingId(null);
      setSwipeDir(null);
    }, 300);
  };

  const isProfileCard = (card: any): card is SwipeCardProfile => 'profile' in card;

  const renderCard = () => {
    if (!currentCard) {
      return (
        <div className="empty-state" style={{ height: '420px', justifyContent: 'center' }}>
          <div className="empty-state__icon">🔍</div>
          <div className="empty-state__title">{t('venture.noCards')}</div>
          <div className="empty-state__text">{t('venture.noCardsDesc')}</div>
        </div>
      );
    }

    const animStyle: React.CSSProperties = swipeDir
      ? {
          transform: `translateX(${swipeDir === 'right' ? '120%' : '-120%'}) rotate(${swipeDir === 'right' ? '15' : '-15'}deg)`,
          opacity: 0,
          transition: 'all 0.3s ease-out',
        }
      : {};

    if (isProfileCard(currentCard)) {
      const { profile, user } = currentCard;
      return (
        <div className="swipe-card" ref={cardRef} style={animStyle}>
          <div className="swipe-card__content">
            <div className="swipe-card__header">
              <div className="swipe-card__avatar">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                ) : (
                  user.fullName[0]?.toUpperCase()
                )}
              </div>
              <div>
                <div className="swipe-card__name">{user.fullName}</div>
                <div className="swipe-card__meta">
                  {profile.title}
                  {user.faculty && ` · ${user.faculty}`}
                  {user.year && ` · ${user.year} курс`}
                </div>
              </div>
            </div>

            <div className="swipe-card__body">
              {profile.bio && (
                <p className="swipe-card__bio">{profile.bio}</p>
              )}

              {profile.skills && profile.skills.length > 0 && (
                <div className="mb-md">
                  <div className="text-sm font-semibold mb-sm">{t('venture.skills')}</div>
                  <div className="swipe-card__skills">
                    {profile.skills.map((skill, i) => (
                      <span key={i} className="skill-tag">{skill}</span>
                    ))}
                  </div>
                </div>
              )}

              {profile.lookingFor && profile.lookingFor.length > 0 && (
                <div>
                  <div className="text-sm font-semibold mb-sm">{t('venture.lookingFor')}</div>
                  <div className="swipe-card__skills">
                    {profile.lookingFor.map((role, i) => (
                      <span key={i} className="skill-tag" style={{ background: 'rgba(167, 139, 250, 0.1)', color: '#a78bfa' }}>
                        {role}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    } else {
      const { project, user } = currentCard as SwipeCardProject;
      return (
        <div className="swipe-card" ref={cardRef} style={animStyle}>
          <div className="swipe-card__content">
            <div className="swipe-card__header">
              <div className="swipe-card__avatar" style={{ background: 'var(--kse-gradient-cool)' }}>
                🚀
              </div>
              <div>
                <div className="swipe-card__name">{project.title}</div>
                <div className="swipe-card__meta">by {user.fullName}</div>
              </div>
            </div>

            <div className="swipe-card__body">
              {project.pitch && (
                <p className="swipe-card__bio">{project.pitch}</p>
              )}

              {project.requiredRoles && project.requiredRoles.length > 0 && (
                <div className="mb-md">
                  <div className="text-sm font-semibold mb-sm">{t('venture.requiredRoles')}</div>
                  <div className="swipe-card__skills">
                    {project.requiredRoles.map((role, i) => (
                      <span key={i} className="skill-tag">{role}</span>
                    ))}
                  </div>
                </div>
              )}

              {project.commitmentLevel && (
                <div className="text-sm text-hint">
                  {t('venture.commitment')}: {project.commitmentLevel}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }
  };

  return (
    <div className="page">
      <h1 className="section-header__title mb-md">{t('venture.title')}</h1>

      {/* Type Tabs */}
      <div className="tabs mb-lg">
        <button
          className={`tab ${deckType === 'profile' ? 'tab--active' : ''}`}
          onClick={() => setDeckType('profile')}
        >
          👤 {t('venture.profiles')}
        </button>
        <button
          className={`tab ${deckType === 'project' ? 'tab--active' : ''}`}
          onClick={() => setDeckType('project')}
        >
          🚀 {t('venture.projects')}
        </button>
      </div>

      {/* Swipe Deck */}
      <div className="swipe-container">
        {renderCard()}
      </div>

      {/* Swipe Buttons */}
      {currentCard && (
        <div className="swipe-actions">
          <button className="swipe-btn swipe-btn--pass" onClick={() => handleSwipe(false)}>
            ✕
          </button>
          <button className="swipe-btn swipe-btn--like" onClick={() => handleSwipe(true)}>
            ❤️
          </button>
        </div>
      )}

      {/* Match Modal */}
      {matchResult?.matched && matchResult.matchedUser && (
        <div className="modal-overlay" onClick={clearMatch}>
          <div className="modal match-modal" onClick={(e) => e.stopPropagation()}>
            <div className="match-modal__confetti">🎉</div>

            <div className="match-modal__avatars">
              <div className="match-modal__avatar">🙋</div>
              <div className="match-modal__heart">💕</div>
              <div className="match-modal__avatar">
                {matchResult.matchedUser.fullName[0]?.toUpperCase()}
              </div>
            </div>

            <h2 className="modal__title">{t('venture.match')}</h2>
            <p className="modal__text">
              {t('venture.matchDesc', { name: matchResult.matchedUser.fullName })}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <a
                href={
                  matchResult.matchedUser.username
                    ? `https://t.me/${matchResult.matchedUser.username}`
                    : `tg://user?id=${matchResult.matchedUser.telegramId}`
                }
                className="btn btn--primary btn--full"
                target="_blank"
                rel="noopener"
              >
                💬 {t('venture.openChat')}
              </a>
              <button className="btn btn--secondary btn--full" onClick={clearMatch}>
                {t('venture.keepSwiping')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
