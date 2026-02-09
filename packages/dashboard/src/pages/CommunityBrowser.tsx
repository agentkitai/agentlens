import React, { useState, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import { communitySearch, communityRate, type SharedLessonData } from '../api/client';

const CATEGORIES = [
  { value: '', label: 'All Categories' },
  { value: 'model-performance', label: 'Model Performance' },
  { value: 'error-patterns', label: 'Error Patterns' },
  { value: 'tool-usage', label: 'Tool Usage' },
  { value: 'cost-optimization', label: 'Cost Optimization' },
  { value: 'prompt-engineering', label: 'Prompt Engineering' },
  { value: 'general', label: 'General' },
];

export default function CommunityBrowser() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [minReputation, setMinReputation] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  const resultsQuery = useApi(
    () => communitySearch({
      query: searchQuery || undefined,
      category: category || undefined,
      minReputation: minReputation > 0 ? minReputation : undefined,
      limit: 20,
    }),
    [searchQuery, category, minReputation],
  );

  const lessons = resultsQuery.data?.lessons ?? [];

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(query);
  }, [query]);

  const handleRate = useCallback(async (lessonId: string, delta: number) => {
    await communityRate(lessonId, delta);
    resultsQuery.refetch();
  }, [resultsQuery]);

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 24px', fontSize: '24px' }}>🌐 Community Browser</h1>

      {/* Search */}
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search community lessons..."
          data-testid="search-input"
          style={{ ...inputStyle, flex: 1 }}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          data-testid="category-filter"
          style={inputStyle}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <button type="submit" style={btnStyle} data-testid="search-btn">Search</button>
      </form>

      {/* Min Reputation Slider */}
      <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <label style={{ fontSize: '14px' }}>Min Reputation: {minReputation}</label>
        <input
          type="range"
          min={0}
          max={100}
          value={minReputation}
          onChange={(e) => setMinReputation(Number(e.target.value))}
          data-testid="reputation-slider"
          style={{ flex: 1, maxWidth: '300px' }}
        />
      </div>

      {/* Results */}
      {resultsQuery.loading && <p>Loading...</p>}
      {resultsQuery.error && <p style={{ color: '#ef4444' }}>Error: {resultsQuery.error}</p>}

      {!resultsQuery.loading && lessons.length === 0 && (
        <p style={{ color: '#888' }}>No lessons found. Try a different search query.</p>
      )}

      {lessons.map((lesson) => (
        <div key={lesson.id} style={cardStyle} data-testid={`lesson-${lesson.id}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <strong>{lesson.title}</strong>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                <span style={badgeStyle}>{lesson.category}</span>
                <span style={{ marginLeft: '8px' }}>⭐ {lesson.reputationScore}</span>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: '14px', color: '#333' }}>
                {lesson.content.slice(0, 200)}{lesson.content.length > 200 ? '...' : ''}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '4px', marginLeft: '12px' }}>
              <button
                onClick={() => handleRate(lesson.id, 1)}
                data-testid={`rate-up-${lesson.id}`}
                style={rateBtnStyle}
                title="Upvote"
              >
                👍
              </button>
              <button
                onClick={() => handleRate(lesson.id, -1)}
                data-testid={`rate-down-${lesson.id}`}
                style={rateBtnStyle}
                title="Downvote"
              >
                👎
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  padding: '16px', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '12px',
};
const btnStyle: React.CSSProperties = {
  padding: '8px 16px', background: '#3b82f6', color: 'white', border: 'none',
  borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
};
const inputStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px',
};
const badgeStyle: React.CSSProperties = {
  padding: '2px 8px', background: '#e2e8f0', borderRadius: '12px', fontSize: '11px',
};
const rateBtnStyle: React.CSSProperties = {
  padding: '4px 8px', background: 'transparent', border: '1px solid #d1d5db',
  borderRadius: '4px', cursor: 'pointer', fontSize: '16px',
};
