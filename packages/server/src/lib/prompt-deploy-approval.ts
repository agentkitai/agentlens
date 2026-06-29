/**
 * AgentGate gating for protected-environment prompt deploys (#120).
 *
 * Mirrors the synchronous `executeAgentgatePolicy` HTTP pattern (blocking call,
 * 10s timeout, decision in the response — AgentGate exposes no approval
 * webhook). Fail-closed: a protected-environment deploy is NOT approved unless
 * AgentGate is configured and explicitly allows it. The request is optionally
 * HMAC-signed (reusing the webhook-signing convention) for integrity.
 */
import { createHmac } from 'node:crypto';
import { createLogger } from './logger.js';

const log = createLogger('PromptDeployApproval');

export interface DeployApprovalRequest {
  templateId: string;
  versionId: string;
  environment: string;
  actorId: string | null;
  action: 'deploy' | 'rollback';
}

export interface DeployApprovalResult {
  approved: boolean;
  approvalRef?: string;
  approverId?: string;
  reason?: string;
  /** true ⇒ no AgentGate configured for a protected env (caller should 503, not record a denial). */
  notConfigured?: boolean;
}

function agentgateUrl(): string | undefined {
  const url = process.env.AGENTGATE_URL?.trim();
  return url ? url.replace(/\/$/, '') : undefined;
}

/**
 * Synchronously ask AgentGate to approve a protected-environment deploy.
 * Returns `{ notConfigured: true }` when AGENTGATE_URL is unset so the caller
 * can fail the request closed (503) rather than silently allowing it.
 */
export async function requestDeployApproval(req: DeployApprovalRequest): Promise<DeployApprovalResult> {
  const base = agentgateUrl();
  if (!base) {
    return {
      approved: false,
      notConfigured: true,
      reason: 'AgentGate not configured (set AGENTGATE_URL) — protected-environment deploys require approval',
    };
  }

  const policyId = process.env.AGENTGATE_PROMPT_POLICY_ID ?? 'prompt-deploy';
  const url = `${base}/api/policies/${encodeURIComponent(policyId)}/check`;
  const body = JSON.stringify({
    action: req.action,
    resource: 'prompt_deployment',
    environment: req.environment,
    templateId: req.templateId,
    versionId: req.versionId,
    agentId: req.actorId,
    triggeredBy: 'agentlens-prompt-deploy',
  });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = process.env.AGENTGATE_WEBHOOK_SECRET?.trim();
  if (secret) {
    headers['X-AgentLens-Signature'] = 'hmac-sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  }

  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      return { approved: false, reason: `AgentGate denied the deploy (HTTP ${res.status})` };
    }
    // Decision in the body; tolerate a bare 200 (no body) as an approval.
    let data: {
      approved?: boolean;
      decision?: string;
      approvalRef?: string;
      id?: string;
      approver?: string;
      approverId?: string;
      reason?: string;
    } = {};
    try {
      data = (await res.json()) as typeof data;
    } catch {
      /* bare 200 ⇒ approved */
    }
    const approved = data.approved !== false && (data.decision ?? 'allow') !== 'deny';
    return {
      approved,
      approvalRef: data.approvalRef ?? data.id ?? `agentgate:${policyId}`,
      approverId: data.approver ?? data.approverId,
      reason: approved ? undefined : (data.reason ?? 'AgentGate denied the deploy'),
    };
  } catch (err) {
    log.warn(`AgentGate approval call failed: ${err instanceof Error ? err.message : String(err)}`);
    return { approved: false, reason: 'AgentGate unreachable; deploy blocked (fail-closed)' };
  }
}
