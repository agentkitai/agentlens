// @vitest-environment jsdom
/**
 * S-5.4 — Page Component Smoke Tests
 *
 * Verifies pages render without crashing with mocked API data.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// ─── Mock react-router-dom ──────────────────────────────────────
vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Link: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
  NavLink: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
}));

// ─── Mock useApi hook ───────────────────────────────────────────
vi.mock('../../hooks/useApi', () => ({
  useApi: () => ({
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// ─── Mock useSSE hook ───────────────────────────────────────────
vi.mock('../../hooks/useSSE', () => ({
  useSSE: () => ({
    data: [],
    error: null,
    connected: false,
  }),
}));

// ─── Mock recharts (avoid SVG rendering issues in jsdom) ────────
vi.mock('recharts', () => {
  const Noop = ({ children }: any) => <div>{children}</div>;
  return {
    ResponsiveContainer: Noop,
    LineChart: Noop,
    Line: () => null,
    BarChart: Noop,
    Bar: () => null,
    AreaChart: Noop,
    Area: () => null,
    PieChart: Noop,
    Pie: () => null,
    Cell: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    CartesianGrid: () => null,
    Legend: () => null,
  };
});

// ─── Mock API client (prevent actual fetch calls) ───────────────
vi.mock('../../api/client', () => {
  const noop = () => Promise.resolve({});
  const noopArr = () => Promise.resolve([]);
  return {
    getKeys: noopArr,
    createKey: noop,
    revokeKey: noop,
    getStats: () => Promise.resolve({ totalEvents: 0, totalSessions: 0, totalAgents: 0 }),
    getConfig: () => Promise.resolve({ retentionDays: 30, agentGateUrl: '', agentGateSecret: '', formBridgeUrl: '', formBridgeSecret: '' }),
    updateConfig: noop,
    getEvents: () => Promise.resolve({ events: [], total: 0, hasMore: false }),
    getSessions: () => Promise.resolve({ sessions: [], total: 0, hasMore: false }),
    getAgents: noopArr,
    getAnalytics: () => Promise.resolve({ buckets: [], totals: {} }),
    getCostAnalytics: () => Promise.resolve({ byAgent: [], overTime: [], totals: {} }),
    getToolAnalytics: () => Promise.resolve({ tools: [] }),
    getAlertRules: noopArr,
    getAlertHistory: () => Promise.resolve({ entries: [], total: 0, hasMore: false }),
    createAlertRule: noop,
    updateAlertRule: noop,
    deleteAlertRule: noop,
    getGuardrailRules: () => Promise.resolve({ rules: [] }),
    getGuardrailHistory: () => Promise.resolve({ triggers: [], total: 0 }),
    updateGuardrailRule: noop,
    deleteGuardrailRule: noop,
    getOverviewStats: () => Promise.resolve({}),
    getSession: noop,
    getSessionTimeline: () => Promise.resolve({ events: [], chainValid: true }),
    getSessionReplay: () => Promise.resolve({ session: {}, events: [], chainValid: true }),
    getAgent: noop,
    getAgentAnalytics: () => Promise.resolve({ agents: [] }),
    getLlmAnalytics: () => Promise.resolve({ summary: {}, byModel: [], byTime: [] }),
    getHealthOverview: () => Promise.resolve({ agents: [], window: 24 }),
    getOptimizationRecommendations: () => Promise.resolve({ recommendations: [], period: 30, totalPotentialSavings: 0 }),
    getBenchmarks: () => Promise.resolve({ benchmarks: [], total: 0, hasMore: false }),
    getLessons: () => Promise.resolve({ lessons: [], total: 0 }),
    recall: () => Promise.resolve({ results: [], query: '', totalResults: 0 }),
    reflect: noop,
    getSharingConfig: noop,
    getCapabilities: () => Promise.resolve({ capabilities: [] }),
    getDelegations: () => Promise.resolve({ delegations: [], total: 0 }),
    communitySearch: () => Promise.resolve({ lessons: [], total: 0 }),
    ApiError: class ApiError extends Error { status: number; constructor(s: number, m: string) { super(m); this.status = s; this.name = 'ApiError'; } },
  };
});

// ─── Tests ──────────────────────────────────────────────────────

describe('Page smoke tests', () => {
  it('Settings renders without crashing', async () => {
    const { default: Settings } = await import('../Settings');
    expect(() => render(<Settings />)).not.toThrow();
  });

  it('Analytics renders without crashing', async () => {
    const { Analytics } = await import('../Analytics');
    expect(() => render(<Analytics />)).not.toThrow();
  });

  it('EventsExplorer renders without crashing', async () => {
    const { EventsExplorer } = await import('../EventsExplorer');
    expect(() => render(<EventsExplorer />)).not.toThrow();
  });

  it('Alerts renders without crashing', async () => {
    const { Alerts } = await import('../Alerts');
    expect(() => render(<Alerts />)).not.toThrow();
  });

  it('GuardrailList renders without crashing', async () => {
    const { default: GuardrailList } = await import('../GuardrailList');
    expect(() => render(<GuardrailList />)).not.toThrow();
  });

  it('Sessions renders without crashing', async () => {
    const { Sessions } = await import('../Sessions');
    expect(() => render(<Sessions />)).not.toThrow();
  });
});
