import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Opportunity } from '../../../types';
import { api } from '../../../api/client';

export function CareersPage() {
  const { t } = useTranslation();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [eligibility, setEligibility] = useState<string>('');
  const [category, setCategory] = useState<string>('');

  const fetchOpportunities = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (eligibility) params.set('eligibility', eligibility);
      if (category) params.set('category', category);
      if (search) params.set('search', search);
      const { opportunities: data } = await api.get<{ opportunities: Opportunity[] }>(
        `/careers?${params}`
      );
      setOpportunities(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOpportunities();
  }, [eligibility, category]);

  useEffect(() => {
    const timer = setTimeout(fetchOpportunities, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const getBadgeClass = (elig: string) => {
    switch (elig) {
      case 'grant': return 'badge--grant';
      case 'contract': return 'badge--contract';
      default: return 'badge--all';
    }
  };

  const getBadgeLabel = (elig: string) => {
    switch (elig) {
      case 'grant': return t('careers.grantOnly');
      case 'contract': return t('careers.contractOnly');
      default: return t('careers.openToAll');
    }
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'internship': return '🎓';
      case 'job': return '💼';
      case 'grant': return '🏆';
      case 'research': return '🔬';
      default: return '📋';
    }
  };

  return (
    <div className="page">
      <h1 className="section-header__title mb-md">{t('careers.title')}</h1>

      {/* Search */}
      <input
        className="input mb-md"
        placeholder={t('careers.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* Category Filters */}
      <div className="filter-chips">
        {[
          { key: '', label: t('careers.all') },
          { key: 'internship', label: `🎓 ${t('careers.internships')}` },
          { key: 'job', label: `💼 ${t('careers.jobs')}` },
          { key: 'grant', label: `🏆 ${t('careers.grants')}` },
          { key: 'research', label: `🔬 ${t('careers.research')}` },
        ].map((f) => (
          <button
            key={f.key}
            className={`filter-chip ${category === f.key ? 'filter-chip--active' : ''}`}
            onClick={() => setCategory(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Eligibility Filters */}
      <div className="filter-chips">
        {[
          { key: '', label: t('careers.openToAll') },
          { key: 'grant', label: `🟢 ${t('careers.grantOnly')}` },
          { key: 'contract', label: `🟡 ${t('careers.contractOnly')}` },
        ].map((f) => (
          <button
            key={f.key}
            className={`filter-chip ${eligibility === f.key ? 'filter-chip--active' : ''}`}
            onClick={() => setEligibility(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Opportunities List */}
      {loading ? (
        <div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton skeleton--card" />
          ))}
        </div>
      ) : opportunities.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">🔍</div>
          <div className="empty-state__title">{t('careers.noResults')}</div>
          <div className="empty-state__text">{t('careers.noResultsDesc')}</div>
        </div>
      ) : (
        opportunities.map((opp) => (
          <div key={opp.id} className="opportunity-card">
            <div className="opportunity-card__top">
              <span className="opportunity-card__company">
                {getCategoryIcon(opp.category)} {opp.company}
              </span>
              <span className={`badge ${getBadgeClass(opp.eligibility)}`}>
                {getBadgeLabel(opp.eligibility)}
              </span>
            </div>

            <div className="opportunity-card__title">{opp.title}</div>

            {opp.description && (
              <div className="opportunity-card__desc">{opp.description}</div>
            )}

            <div className="opportunity-card__footer">
              <div className="opportunity-card__meta">
                {opp.domain && <span className="badge badge--all">{opp.domain}</span>}
                {opp.salaryInfo && (
                  <span className="text-sm text-hint">💰 {opp.salaryInfo}</span>
                )}
                {opp.deadline && (
                  <span className="text-sm text-hint">
                    📅 {new Date(opp.deadline).toLocaleDateString('uk', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                )}
              </div>

              {opp.url && (
                <a
                  href={opp.url}
                  target="_blank"
                  rel="noopener"
                  className="btn btn--primary btn--small"
                >
                  {t('careers.apply')} ↗
                </a>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
