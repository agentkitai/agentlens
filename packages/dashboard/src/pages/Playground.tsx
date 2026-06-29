/**
 * LLM Playground (#144)
 *
 * Route: /playground  (optionally `?prompt=<text>` to prefill — "Open in Playground").
 *
 * Edit a prompt, fill its {{variables}}, and run it against configured LLM
 * connections (#143) — side by side. Variables are compiled client-side via the
 * shared prompt-compile engine (#145); output shows tokens, cost, and latency.
 */
import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { compileText, extractVariables } from '@agentkitai/agentlens-core';
import { useApi } from '../hooks/useApi';
import { listConnections, type LlmConnection } from '../api/llm-connections';
import { runPlayground, type PlaygroundRunResult } from '../api/playground';

interface PanelState {
  connectionId: string;
  model: string;
  temperature: string;
  result: PlaygroundRunResult | null;
  error: string | null;
  running: boolean;
}

function emptyPanel(): PanelState {
  return { connectionId: '', model: '', temperature: '', result: null, error: null, running: false };
}

export function Playground(): React.ReactElement {
  const [params] = useSearchParams();
  const { data } = useApi(() => listConnections(), []);
  const connections: LlmConnection[] = data?.connections ?? [];

  const [prompt, setPrompt] = useState(params.get('prompt') ?? 'Summarize this in one sentence: {{text}}');
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [panels, setPanels] = useState<PanelState[]>([emptyPanel(), emptyPanel()]);

  const variables = useMemo(() => extractVariables(prompt), [prompt]);

  function setPanel(i: number, patch: Partial<PanelState>): void {
    setPanels((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  async function run(i: number): Promise<void> {
    const panel = panels[i]!;
    if (!panel.connectionId) {
      setPanel(i, { error: 'Pick a connection first.' });
      return;
    }
    setPanel(i, { running: true, error: null });
    const { text, missing } = compileText(prompt, varValues);
    if (missing.length > 0) {
      setPanel(i, { running: false, error: `Fill in: ${missing.join(', ')}` });
      return;
    }
    try {
      const result = await runPlayground({
        connectionId: panel.connectionId,
        model: panel.model.trim() || undefined,
        temperature: panel.temperature.trim() ? Number(panel.temperature) : undefined,
        prompt: text,
      });
      setPanel(i, { running: false, result });
    } catch (e) {
      setPanel(i, { running: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  function runBoth(): void {
    void run(0);
    void run(1);
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Playground</h1>
          <p className="text-sm text-gray-500 mt-1">Run a prompt against your connections and compare side by side.</p>
        </div>
        <button onClick={runBoth} className="px-4 py-2 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700">
          Run both
        </button>
      </div>

      {connections.length === 0 && (
        <div className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
          No LLM connections yet. Add one in <b>Settings → LLM Connections</b> to run the playground.
        </div>
      )}

      {/* Shared prompt + variables */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
        <label className="block text-xs font-medium text-gray-600 mb-1">Prompt (use {'{{variables}}'})</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
        />
        {variables.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {variables.map((v) => (
              <label key={v} className="text-sm">
                <span className="block text-xs font-medium text-gray-600 mb-1">{v}</span>
                <input
                  value={varValues[v] ?? ''}
                  onChange={(e) => setVarValues((vv) => ({ ...vv, [v]: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                />
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Side-by-side panels */}
      <div className="grid grid-cols-2 gap-4">
        {panels.map((panel, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-xs font-semibold text-gray-400 mb-2">Variant {String.fromCharCode(65 + i)}</div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <select
                value={panel.connectionId}
                onChange={(e) => setPanel(i, { connectionId: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              >
                <option value="">Connection…</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.provider})</option>
                ))}
              </select>
              <input
                value={panel.model}
                onChange={(e) => setPanel(i, { model: e.target.value })}
                placeholder="model (or default)"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-center gap-2 mb-3">
              <input
                value={panel.temperature}
                onChange={(e) => setPanel(i, { temperature: e.target.value })}
                placeholder="temp"
                className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
              />
              <button
                onClick={() => void run(i)}
                disabled={panel.running}
                className="px-3 py-1.5 rounded bg-gray-800 text-white text-sm hover:bg-black disabled:opacity-50"
              >
                {panel.running ? 'Running…' : 'Run'}
              </button>
            </div>

            {panel.error && <div className="text-sm text-red-600">{panel.error}</div>}
            {panel.result && (
              <div>
                <pre className="text-sm whitespace-pre-wrap bg-gray-50 border border-gray-100 rounded p-3 max-h-72 overflow-auto">
                  {panel.result.output.content || '(empty)'}
                </pre>
                <div className="text-xs text-gray-500 mt-2 flex gap-3">
                  <span>{panel.result.output.usage.inputTokens}→{panel.result.output.usage.outputTokens} tok</span>
                  <span>${panel.result.costUsd.toFixed(6)}</span>
                  <span>{panel.result.latencyMs} ms</span>
                  <span>{panel.result.output.model}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default Playground;
