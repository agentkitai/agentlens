import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { getSharingAuditLog, type SharingAuditEventData } from '../api/client';

const EVENT_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'share', label: 'Share' },
  { value: 'query', label: 'Query' },
  { value: 'purge', label: 'Purge' },
  { value: 'rate', label: 'Rate' },
  { value: 'flag', label: 'Flag' },
];

function formatTimestamp(ts: string): string {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

export default function SharingActivity() {
  const [eventType, setEventType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const auditQuery = useApi(
    () => getSharingAuditLog({
      eventType: eventType || undefined,
      from: dateFrom || undefined,
      to: dateTo || undefined,
      limit: 100,
    }),
    [eventType, dateFrom, dateTo],
  );

  const events = auditQuery.data?.events ?? [];

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 24px', fontSize: '24px' }}>📋 Sharing Activity</h1>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          data-testid="event-type-filter"
          style={inputStyle}
        >
          {EVENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          data-testid="date-from"
          style={inputStyle}
          placeholder="From"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          data-testid="date-to"
          style={inputStyle}
          placeholder="To"
        />
      </div>

      {/* Activity Feed */}
      {auditQuery.loading && <p>Loading...</p>}
      {auditQuery.error && <p style={{ color: '#ef4444' }}>Error: {auditQuery.error}</p>}

      {!auditQuery.loading && events.length === 0 && (
        <p style={{ color: '#888' }}>No activity found.</p>
      )}

      <div>
        {events.map((event) => (
          <div key={event.id} style={cardStyle} data-testid={`event-${event.id}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={badgeStyle}>{event.eventType}</span>
                <span style={{ marginLeft: '8px', fontSize: '13px', color: '#64748b' }}>
                  {formatTimestamp(event.timestamp)}
                </span>
              </div>
              <span style={{ fontSize: '12px', color: '#888' }}>by {event.initiatedBy}</span>
            </div>
            {event.lessonId && (
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#666' }}>Lesson: {event.lessonId}</p>
            )}
            {event.queryText && (
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#666' }}>Query: "{event.queryText}"</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '8px',
};
const inputStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px',
};
const badgeStyle: React.CSSProperties = {
  padding: '2px 8px', background: '#dbeafe', color: '#1e40af', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
};
