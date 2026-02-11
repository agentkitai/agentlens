import { getErrorMessage } from '@agentlensai/core';
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getAgents,
  getGuardrailStatus,
  createGuardrailRule,
  updateGuardrailRule,
  type CreateGuardrailData,
} from '../api/client';

// ─── Constants ──────────────────────────────────────────────────

const CONDITION_TYPES = [
  { value: 'error_rate_threshold', label: 'Error Rate Threshold' },
  { value: 'cost_limit', label: 'Cost Limit' },
  { value: 'health_score_threshold', label: 'Health Score Threshold' },
  { value: 'custom_metric', label: 'Custom Metric' },
] as const;

const ACTION_TYPES = [
  { value: 'pause_agent', label: 'Pause Agent' },
  { value: 'notify_webhook', label: 'Notify Webhook' },
  { value: 'downgrade_model', label: 'Downgrade Model' },
  { value: 'agentgate_policy', label: 'AgentGate Policy' },
] as const;

const OPERATORS = ['gt', 'gte', 'lt', 'lte', 'eq'] as const;

// ─── Condition Config Fields ────────────────────────────────────

function ConditionConfigFields({ type, config, onChange }: {
  type: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });

  switch (type) {
    case 'error_rate_threshold':
      return (
        <div style={fieldGroupStyle}>
          <label>Threshold (%)<br />
            <input type="number" min={0} max={100} value={config.threshold as number ?? 30}
              onChange={e => set('threshold', Number(e.target.value))} style={inputStyle} />
          </label>
          <label>Window (ms)<br />
            <input type="number" min={1000} value={config.windowMs as number ?? 300000}
              onChange={e => set('windowMs', Number(e.target.value))} style={inputStyle} />
          </label>
        </div>
      );
    case 'cost_limit':
      return (
        <div style={fieldGroupStyle}>
          <label>Max Cost ($)<br />
            <input type="number" min={0} step={0.01} value={config.maxCostUsd as number ?? 10}
              onChange={e => set('maxCostUsd', Number(e.target.value))} style={inputStyle} />
          </label>
          <label>Period (ms)<br />
            <input type="number" min={1000} value={config.periodMs as number ?? 86400000}
              onChange={e => set('periodMs', Number(e.target.value))} style={inputStyle} />
          </label>
        </div>
      );
    case 'health_score_threshold':
      return (
        <div style={fieldGroupStyle}>
          <label>Min Score<br />
            <input type="number" min={0} max={100} value={config.minScore as number ?? 50}
              onChange={e => set('minScore', Number(e.target.value))} style={inputStyle} />
          </label>
          <label>Dimension<br />
            <input type="text" value={config.dimension as string ?? ''}
              onChange={e => set('dimension', e.target.value)} style={inputStyle}
              placeholder="e.g. reliability" />
          </label>
        </div>
      );
    case 'custom_metric':
      return (
        <div style={fieldGroupStyle}>
          <label>Metric Key<br />
            <input type="text" value={config.metricKey as string ?? ''}
              onChange={e => set('metricKey', e.target.value)} style={inputStyle} />
          </label>
          <label>Operator<br />
            <select value={config.operator as string ?? 'gt'}
              onChange={e => set('operator', e.target.value)} style={inputStyle}>
              {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
            </select>
          </label>
          <label>Value<br />
            <input type="number" value={config.value as number ?? 0}
              onChange={e => set('value', Number(e.target.value))} style={inputStyle} />
          </label>
        </div>
      );
    default:
      return null;
  }
}

// ─── Action Config Fields ───────────────────────────────────────

function ActionConfigFields({ type, config, onChange }: {
  type: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });

  switch (type) {
    case 'pause_agent':
      return (
        <div style={fieldGroupStyle}>
          <label>Reason<br />
            <input type="text" value={config.reason as string ?? ''}
              onChange={e => set('reason', e.target.value)} style={inputStyle}
              placeholder="Reason for pausing" />
          </label>
        </div>
      );
    case 'notify_webhook':
      return (
        <div style={fieldGroupStyle}>
          <label>Webhook URL<br />
            <input type="url" value={config.url as string ?? ''}
              onChange={e => set('url', e.target.value)} style={inputStyle}
              pattern="https?://.*"
              title="Must be an http:// or https:// URL"
              placeholder="https://..." required />
          </label>
        </div>
      );
    case 'downgrade_model':
      return (
        <div style={fieldGroupStyle}>
          <label>Target Model<br />
            <input type="text" value={config.targetModel as string ?? ''}
              onChange={e => set('targetModel', e.target.value)} style={inputStyle}
              placeholder="e.g. gpt-3.5-turbo" />
          </label>
        </div>
      );
    case 'agentgate_policy':
      return (
        <div style={fieldGroupStyle}>
          <label>Policy ID<br />
            <input type="text" value={config.policyId as string ?? ''}
              onChange={e => set('policyId', e.target.value)} style={inputStyle} />
          </label>
        </div>
      );
    default:
      return null;
  }
}

// ─── Main Form ──────────────────────────────────────────────────

export default function GuardrailForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);

  const [name, setName] = useState('');
  const [agentId, setAgentId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [dryRun, setDryRun] = useState(false);
  const [conditionType, setConditionType] = useState('error_rate_threshold');
  const [conditionConfig, setConditionConfig] = useState<Record<string, unknown>>({});
  const [actionType, setActionType] = useState('pause_agent');
  const [actionConfig, setActionConfig] = useState<Record<string, unknown>>({});
  const [cooldownMinutes, setCooldownMinutes] = useState(15);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load agents for dropdown
  useEffect(() => {
    getAgents().then(a => setAgents(a)).catch(() => {});
  }, []);

  // Load existing rule for editing
  useEffect(() => {
    if (!id) return;
    getGuardrailStatus(id).then(({ rule }) => {
      setName(rule.name);
      setAgentId(rule.agentId ?? '');
      setEnabled(rule.enabled);
      setDryRun(rule.dryRun);
      setConditionType(rule.conditionType);
      setConditionConfig(rule.conditionConfig);
      setActionType(rule.actionType);
      setActionConfig(rule.actionConfig);
      setCooldownMinutes(rule.cooldownMinutes);
    }).catch(err => setError(`Failed to load rule: ${err}`));
  }, [id]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Name is required');
      setSaving(false);
      return;
    }

    const data: CreateGuardrailData = {
      name: trimmedName,
      conditionType,
      conditionConfig,
      actionType,
      actionConfig,
      cooldownMinutes,
      enabled,
      dryRun,
      ...(agentId ? { agentId } : {}),
    };

    try {
      if (isEdit && id) {
        await updateGuardrailRule(id, data);
      } else {
        await createGuardrailRule(data);
      }
      navigate('/guardrails');
    } catch (err: unknown) {
      setError(getErrorMessage(err) ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [name, agentId, enabled, dryRun, conditionType, conditionConfig, actionType, actionConfig, cooldownMinutes, isEdit, id, navigate]);

  return (
    <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', marginBottom: '24px' }}>
        {isEdit ? '✏️ Edit Guardrail Rule' : '🛡️ Create Guardrail Rule'}
      </h1>

      {error && <div style={{ color: '#ef4444', marginBottom: '16px', padding: '8px', background: '#fef2f2', borderRadius: '4px' }}>{error}</div>}

      <form onSubmit={handleSubmit}>
        {/* Basic fields */}
        <div style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Basic</h3>
          <div style={fieldGroupStyle}>
            <label>Name *<br />
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                required minLength={1} style={inputStyle} placeholder="My Guardrail Rule" />
            </label>
            <label>Agent<br />
              <select value={agentId} onChange={e => setAgentId(e.target.value)} style={inputStyle}>
                <option value="">All Agents</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: '24px', marginTop: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Enabled
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} /> Dry Run
            </label>
            <label>Cooldown (min):{' '}
              <input type="number" min={0} value={cooldownMinutes}
                onChange={e => setCooldownMinutes(Number(e.target.value))}
                style={{ ...inputStyle, width: '80px' }} />
            </label>
          </div>
        </div>

        {/* Condition */}
        <div style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Condition</h3>
          <label>Type<br />
            <select value={conditionType} onChange={e => {
              const newType = e.target.value;
              setConditionType(newType);
              const defaults: Record<string, Record<string, unknown>> = {
                error_rate_threshold: { threshold: 30, windowMs: 300000 },
                cost_limit: { maxCostUsd: 100, periodMs: 3600000 },
                health_score_threshold: { minScore: 50, dimension: '' },
                custom_metric: { metricKey: '', operator: 'gt', value: 0 },
              };
              setConditionConfig(defaults[newType] ?? {});
            }} style={inputStyle}>
              {CONDITION_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <div style={{ marginTop: '12px' }}>
            <ConditionConfigFields type={conditionType} config={conditionConfig} onChange={setConditionConfig} />
          </div>
        </div>

        {/* Action */}
        <div style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Action</h3>
          <label>Type<br />
            <select value={actionType} onChange={e => { setActionType(e.target.value); setActionConfig({}); }} style={inputStyle}>
              {ACTION_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <div style={{ marginTop: '12px' }}>
            <ActionConfigFields type={actionType} config={actionConfig} onChange={setActionConfig} />
          </div>
        </div>

        {/* Submit */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
          <button type="submit" disabled={saving} style={btnStyle}>
            {saving ? 'Saving...' : isEdit ? 'Update Rule' : 'Create Rule'}
          </button>
          <button type="button" onClick={() => navigate('/guardrails')} style={cancelBtnStyle}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  padding: '16px', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '16px',
};

const sectionTitleStyle: React.CSSProperties = { margin: '0 0 12px', fontSize: '16px', color: '#334155' };

const fieldGroupStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px',
  fontSize: '14px', marginTop: '4px',
};

const btnStyle: React.CSSProperties = {
  padding: '10px 20px', background: '#3b82f6', color: 'white', border: 'none',
  borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: 600,
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '10px 20px', background: 'transparent', border: '1px solid #d1d5db',
  borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
};

export { GuardrailForm };
