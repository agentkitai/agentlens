import React from 'react';

export function PageSkeleton(): React.ReactElement {
  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ height: 32, width: '40%', background: '#e5e7eb', borderRadius: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
      <div style={{ height: 20, width: '70%', background: '#e5e7eb', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
      <div style={{ height: 200, width: '100%', background: '#f3f4f6', borderRadius: 8, marginTop: '1rem', animation: 'pulse 1.5s ease-in-out infinite' }} />
      <div style={{ height: 200, width: '100%', background: '#f3f4f6', borderRadius: 8, animation: 'pulse 1.5s ease-in-out infinite' }} />
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}
