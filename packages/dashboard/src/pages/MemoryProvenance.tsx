import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { getMemoryProvenance, type LoreProvenance, type SupersessionLink } from '../api/lore';

function formatDate(ts: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function TrustBadge({ signal }: { signal: string }): React.ReactElement {
  const owned = signal === 'owned';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        owned ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
      }`}
    >
      {owned ? '🔒 Owned' : '👤 Anonymous'}
    </span>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="w-32 shrink-0 text-xs font-medium uppercase tracking-wide text-gray-400">{label}</span>
      <span className="text-sm text-gray-900">{children}</span>
    </div>
  );
}

function LinkRow({ link, view }: { link: SupersessionLink; view: 'chain' | 'sources' }): React.ReactElement {
  // chain: this memory was superseded BY supersededBy (the successor, →).
  // sources: memoryId is the source memory consolidated INTO this one (←).
  const targetId = view === 'chain' ? link.supersededBy : link.memoryId;
  const arrow = view === 'chain' ? '→' : '←';
  return (
    <div className="flex items-start gap-3 border-l-2 border-gray-200 py-2 pl-3">
      <span className="inline-flex shrink-0 items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
        {link.agent}
      </span>
      <div className="min-w-0">
        <p className="text-sm text-gray-900">{link.reason || <span className="text-gray-400">(no reason)</span>}</p>
        <p className="mt-0.5 text-xs text-gray-400">
          {formatDate(link.ts)}
          {targetId && (
            <>
              {` · ${arrow} `}
              <span className="font-mono">{targetId}</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export function MemoryProvenance(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const prov = useApi<LoreProvenance | null>(() => getMemoryProvenance(id!), [id]);
  const [view, setView] = useState<'chain' | 'sources'>('chain');

  return (
    <div className="space-y-6">
      <div>
        <Link to="/memories" className="text-sm text-blue-600 hover:underline">
          ← Back to Memories
        </Link>
      </div>

      {prov.loading && <div className="py-12 text-center text-gray-500">Loading lineage…</div>}

      {!prov.loading && prov.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
          <p className="text-red-600">Unable to load lineage</p>
          <p className="mt-1 text-sm text-red-400">{prov.error}</p>
        </div>
      )}

      {!prov.loading && !prov.error && !prov.data && (
        <div className="py-12 text-center text-gray-500">
          Memory not found — or this Lore server predates the provenance endpoint (#82).
        </div>
      )}

      {prov.data &&
        (() => {
          const p = prov.data;
          const links = view === 'chain' ? p.supersessionChain : p.supersessionSources;
          return (
            <>
              {/* Header */}
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-bold text-gray-900">Memory Provenance</h1>
                <TrustBadge signal={p.trustSignal} />
                <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                  {p.visibility}
                </span>
                <span className="text-xs text-gray-400">created {formatDate(p.createdAt)}</span>
              </div>
              <p className="-mt-3 font-mono text-xs text-gray-400">{p.id}</p>

              {/* Metadata */}
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <MetaRow label="Owner">{p.owner ?? <span className="text-gray-400">— (anonymous)</span>}</MetaRow>
                <MetaRow label="Source">{p.source ?? <span className="text-gray-400">—</span>}</MetaRow>
                <MetaRow label="Visibility">{p.visibility}</MetaRow>
                <MetaRow label="Tags">
                  {p.tags.length ? (
                    <span className="flex flex-wrap gap-1">
                      {p.tags.map((t) => (
                        <span key={t} className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                          {t}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </MetaRow>
                {p.redactionTags.length > 0 && (
                  <MetaRow label="Redaction">
                    <span className="flex flex-wrap gap-1">
                      {p.redactionTags.map((t) => (
                        <span key={t} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          ⚠ {t}
                        </span>
                      ))}
                    </span>
                  </MetaRow>
                )}
              </div>

              {/* Lineage */}
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-3 flex gap-2">
                  <button
                    onClick={() => setView('chain')}
                    className={`rounded-md px-3 py-1 text-sm ${
                      view === 'chain' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    Superseded by ({p.supersessionChain.length})
                  </button>
                  <button
                    onClick={() => setView('sources')}
                    className={`rounded-md px-3 py-1 text-sm ${
                      view === 'sources' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    Consolidated from ({p.supersessionSources.length})
                  </button>
                </div>
                <p className="mb-2 text-xs text-gray-400">
                  {view === 'chain'
                    ? 'Forward audit trail — what this memory was superseded by.'
                    : 'Source memories this one consolidated.'}
                </p>
                {links.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-400">No lineage recorded.</p>
                ) : (
                  <div className="space-y-1">
                    {links.map((l, i) => (
                      <LinkRow key={`${l.memoryId}-${l.supersededBy ?? 'none'}-${i}`} link={l} view={view} />
                    ))}
                  </div>
                )}
              </div>
            </>
          );
        })()}
    </div>
  );
}
