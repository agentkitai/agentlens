import { request, toQueryString } from './core';

// ─── Types ──────────────────────────────────────────────────

export interface ChainVerification {
  verified: boolean;
  sessionsChecked: number;
  brokenChains: string[];
  checkedAt?: string;
}

export interface ComplianceReportSummary {
  generatedAt: string;
  range: { from: string; to: string };
  totalEvents: number;
  agentCount: number;
  sessionCount: number;
  guardrailTriggers: number;
  chainVerification: ChainVerification;
  signature?: string;
}

export interface ExportHistoryEntry {
  id: string;
  generatedAt: string;
  rangeFrom: string;
  rangeTo: string;
  format: 'json' | 'csv';
}

// ─── API Functions ──────────────────────────────────────────

export async function verifyAuditChain(): Promise<ChainVerification> {
  return request<ChainVerification>('/api/audit/verify');
}

export async function generateComplianceReport(from: string, to: string): Promise<ComplianceReportSummary> {
  const qs = toQueryString({ from, to });
  return request<ComplianceReportSummary>(`/api/compliance/report${qs}`);
}

export function getExportEventsUrl(from: string, to: string, format: 'json' | 'csv'): string {
  const qs = toQueryString({ from, to, format });
  return `/api/compliance/export/events${qs}`;
}
