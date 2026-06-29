/**
 * LLM Connections settings tab (#143)
 *
 * Register bring-your-own provider keys so the server can run prompts/evaluators.
 * The key is sent once on create and never displayed again (only the last 4).
 */
import React, { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import {
  listConnections,
  createConnection,
  deleteConnection,
  testConnection,
  type LlmConnection,
} from '../../api/llm-connections';

const PROVIDERS = ['openai', 'anthropic', 'azure', 'bedrock', 'vertex', 'custom'];

export function LlmConnectionsTab(): React.ReactElement {
  const { data, loading, error, refetch } = useApi(() => listConnections(), []);
  const connections: LlmConnection[] = data?.connections ?? [];

  const [provider, setProvider] = useState('openai');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  async function onCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await createConnection({
        provider,
        name: name.trim(),
        apiKey,
        baseUrl: baseUrl.trim() || undefined,
        defaultModel: defaultModel.trim() || undefined,
      });
      setName('');
      setApiKey('');
      setBaseUrl('');
      setDefaultModel('');
      refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function onTest(id: string): Promise<void> {
    setTestResult((r) => ({ ...r, [id]: 'testing…' }));
    try {
      const res = await testConnection(id);
      setTestResult((r) => ({ ...r, [id]: res.ok ? `✓ ok (${res.model ?? 'model'})` : `✗ ${res.error ?? 'failed'}` }));
    } catch (err) {
      setTestResult((r) => ({ ...r, [id]: `✗ ${err instanceof Error ? err.message : String(err)}` }));
    }
  }

  async function onDelete(id: string): Promise<void> {
    await deleteConnection(id);
    refetch();
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        Provider credentials the server uses to run prompts and evaluators (Playground, server-side scoring). Keys
        are encrypted at rest and never shown again — only the last 4 characters.
      </p>

      {/* Add form */}
      <form onSubmit={onCreate} className="bg-white border border-gray-200 rounded-lg p-4 grid grid-cols-2 gap-3 max-w-2xl">
        <label className="text-sm">
          <span className="block text-xs font-medium text-gray-600 mb-1">Provider</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs font-medium text-gray-600 mb-1">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="Production OpenAI" />
        </label>
        <label className="text-sm col-span-2">
          <span className="block text-xs font-medium text-gray-600 mb-1">API key</span>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required autoComplete="off" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono" placeholder="sk-…" />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-medium text-gray-600 mb-1">Base URL (optional)</span>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="https://…" />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-medium text-gray-600 mb-1">Default model (optional)</span>
          <input value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="gpt-4o" />
        </label>
        {formError && <div className="col-span-2 text-sm text-red-600">{formError}</div>}
        <div className="col-span-2">
          <button type="submit" disabled={submitting} className="px-4 py-1.5 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50">
            {submitting ? 'Saving…' : 'Add connection'}
          </button>
        </div>
      </form>

      {/* List */}
      {loading && <div className="text-gray-500 text-sm">Loading…</div>}
      {error && <div className="text-red-600 text-sm">Failed to load connections: {error}</div>}
      {!loading && connections.length === 0 && <div className="text-gray-500 text-sm">No connections yet.</div>}

      {connections.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {connections.map((c) => (
            <div key={c.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="font-medium text-gray-900">
                  {c.name} <span className="text-xs text-gray-400">({c.provider})</span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5 font-mono">
                  ••••{c.keyLast4}
                  {c.defaultModel && <> · {c.defaultModel}</>}
                  {c.baseUrl && <> · {c.baseUrl}</>}
                </div>
                {testResult[c.id] && <div className="text-xs mt-1 text-gray-600">{testResult[c.id]}</div>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => void onTest(c.id)} className="px-2 py-1 rounded border border-gray-300 text-gray-700 text-xs hover:bg-gray-50">
                  Test
                </button>
                <button onClick={() => void onDelete(c.id)} className="px-2 py-1 rounded border border-red-200 text-red-600 text-xs hover:bg-red-50">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default LlmConnectionsTab;
