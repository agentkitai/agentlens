/**
 * PromptDeployments (#120) — environment deploy lifecycle for a prompt template:
 * live version per environment, deploy / rollback actions (protected envs are
 * AgentGate-gated server-side), a tamper-evident deploy-history timeline, and a
 * ledger-verify button. Append-only: rollback is a new ledger row, never a delete.
 */
import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import {
  getPromptEnvironments,
  getPromptDeployments,
  deployPromptVersion,
  rollbackPromptVersion,
  verifyDeployLedger,
} from '../api/prompts';
import type { PromptVersion, PromptDeployment, DeployLedgerVerifyResult } from '../api/prompts';

interface Props {
  templateId: string;
  versions: PromptVersion[];
  liveVersions: Record<string, string>;
  /** Called after a successful deploy/rollback so the parent can refetch live versions. */
  onChange: () => void;
}

const ENV_TONE: Record<string, string> = {
  prod: 'bg-red-100 text-red-800 border-red-300',
  production: 'bg-red-100 text-red-800 border-red-300',
  staging: 'bg-yellow-100 text-yellow-800 border-yellow-300',
};
const envTone = (env: string): string => ENV_TONE[env] ?? 'bg-gray-100 text-gray-700 border-gray-300';
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function StatusBadge({ d }: { d: PromptDeployment }) {
  const denied = d.status === 'denied';
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
        denied ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
      }`}
    >
      {denied ? '✗ denied' : d.action === 'rollback' ? '↩ rolled back' : '✓ deployed'}
    </span>
  );
}

export function PromptDeployments({ templateId, versions, liveVersions, onChange }: Props) {
  const { data: environments } = useApi(() => getPromptEnvironments(), []);
  const { data: deployments, refetch } = useApi(() => getPromptDeployments(templateId), [templateId]);

  const [environment, setEnvironment] = useState('');
  const [versionId, setVersionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<DeployLedgerVerifyResult | null>(null);

  const verNum = (id?: string): number | undefined => versions.find((v) => v.id === id)?.versionNumber;
  const env = environment || environments?.[0]?.name || '';
  const ver = versionId || versions[0]?.id || '';

  async function run(action: 'deploy' | 'rollback') {
    if (!env || !ver) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'deploy') await deployPromptVersion(templateId, { environment: env, versionId: ver });
      else await rollbackPromptVersion(templateId, { environment: env, toVersionId: ver });
      refetch();
      onChange();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!env) return;
    setError(null);
    try {
      setVerifyResult(await verifyDeployLedger(env));
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
      <h2 className="text-sm font-semibold text-gray-900">Deployments</h2>

      {/* Live version per environment */}
      <div className="flex flex-wrap gap-2">
        {(environments ?? []).map((e) => {
          const live = liveVersions[e.name];
          return (
            <span
              key={e.name}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${envTone(e.name)}`}
              title={e.protected ? 'Protected — promotion requires AgentGate approval' : undefined}
            >
              {e.protected && <span>🔒</span>}
              {e.name}: {live ? `v${verNum(live) ?? '?'}` : '—'}
            </span>
          );
        })}
      </div>

      {/* Deploy / rollback */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-600">
          Environment
          <select
            value={env}
            onChange={(ev) => setEnvironment(ev.target.value)}
            className="block mt-0.5 border border-gray-300 rounded px-2 py-1 text-sm"
          >
            {(environments ?? []).map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
                {e.protected ? ' (protected)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Version
          <select
            value={ver}
            onChange={(ev) => setVersionId(ev.target.value)}
            className="block mt-0.5 border border-gray-300 rounded px-2 py-1 text-sm"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.versionNumber}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => run('deploy')}
          disabled={busy || !ver || !env}
          className="px-3 py-1.5 text-sm rounded bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
        >
          Deploy
        </button>
        <button
          onClick={() => run('rollback')}
          disabled={busy || !ver || !env}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Roll back
        </button>
        <button
          onClick={verify}
          disabled={!env}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          Verify ledger
        </button>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
      {verifyResult && (
        <div className={`text-sm ${verifyResult.valid ? 'text-green-700' : 'text-red-700'}`}>
          Ledger “{verifyResult.environment}”:{' '}
          {verifyResult.valid
            ? `✓ verified (${verifyResult.count} record${verifyResult.count !== 1 ? 's' : ''})`
            : `✗ broken at seq ${verifyResult.brokenAtSeq} — ${verifyResult.reason}`}
        </div>
      )}

      {/* Deploy history (newest first) */}
      <div className="space-y-1">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">History</h3>
        {deployments && deployments.length === 0 && <p className="text-sm text-gray-500">No deployments yet.</p>}
        {(deployments ?? []).map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-2 py-1 text-sm border-b border-gray-100 last:border-0">
            <StatusBadge d={d} />
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${envTone(d.environment)}`}>
              {d.environment}
            </span>
            <span className="font-medium text-gray-800">v{verNum(d.versionId) ?? '?'}</span>
            <span className="text-gray-500">by {d.actorId ?? 'unknown'}</span>
            {d.approverId && <span className="text-gray-500">· approved by {d.approverId}</span>}
            <span className="ml-auto text-xs text-gray-400 tabular-nums">{new Date(d.createdAt).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
