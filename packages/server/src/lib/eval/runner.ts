/**
 * EvalRunner — Run Orchestration (Feature 15 — Story 7)
 *
 * Executes eval runs: loads test cases, POSTs to webhook,
 * scores responses, saves results, computes aggregates.
 */

import type {
  EvalRunConfig,
  EvalWebhookRequest,
  EvalWebhookResponse,
  EvalTestCase,
  ScoreResult,
} from '@agentlensai/core';
import type { EvalStore } from '../../db/eval-store.js';
import type { ScorerRegistry, ScorerContext } from './scorers/index.js';

// ─── Concurrency Utilities ────────────────────────────────

class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      this.active++;
      next();
    }
  }
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(private rate: number) {
    this.tokens = rate;
    this.lastRefill = Date.now();
  }

  async consume(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens--;
      return;
    }
    const waitMs = (1 / this.rate) * 1000;
    await sleep(waitMs);
    this.refill();
    this.tokens--;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.rate, this.tokens + elapsed * this.rate);
    this.lastRefill = now;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Runner ────────────────────────────────────────────────

export interface EvalRunnerDeps {
  evalStore: EvalStore;
  scorerRegistry: ScorerRegistry;
  fetch?: typeof globalThis.fetch;
}

export class EvalRunner {
  private evalStore: EvalStore;
  private scorerRegistry: ScorerRegistry;
  private fetchFn: typeof globalThis.fetch;
  private cancelledRuns = new Set<string>();

  constructor(deps: EvalRunnerDeps) {
    this.evalStore = deps.evalStore;
    this.scorerRegistry = deps.scorerRegistry;
    this.fetchFn = deps.fetch ?? globalThis.fetch;
  }

  /**
   * Execute an eval run. Called asynchronously from the route handler.
   */
  async execute(runId: string, tenantId: string): Promise<void> {
    const run = this.evalStore.getRun(tenantId, runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    const config = run.config;
    const testCases = this.evalStore.getTestCases(run.datasetId);

    if (testCases.length === 0) {
      this.evalStore.updateRunStatus(runId, 'completed', {
        totalCases: 0,
        passedCases: 0,
        failedCases: 0,
        avgScore: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      return;
    }

    // Transition to running
    const startedAt = new Date().toISOString();
    this.evalStore.updateRunStatus(runId, 'running', { startedAt });

    const semaphore = new Semaphore(config.concurrency || 5);
    const tokenBucket = config.rateLimitPerSec ? new TokenBucket(config.rateLimitPerSec) : null;
    const timeoutMs = config.timeoutMs ?? 30000;
    const retries = config.retries ?? 0;
    const passThreshold = config.passThreshold ?? 0.7;

    let totalScore = 0;
    let passedCases = 0;
    let failedCases = 0;
    let totalCost = 0;
    let totalLatency = 0;

    try {
      const promises = testCases.map(async (testCase) => {
        if (this.cancelledRuns.has(runId)) return;

        await semaphore.acquire();
        try {
          if (tokenBucket) await tokenBucket.consume();
          if (this.cancelledRuns.has(runId)) return;

          const caseStart = Date.now();
          let webhookResponse: EvalWebhookResponse | null = null;
          let error: string | undefined;

          // Call webhook with retries
          for (let attempt = 0; attempt <= retries; attempt++) {
            try {
              webhookResponse = await this.callWebhook(runId, testCase, run.webhookUrl, timeoutMs);
              break;
            } catch (e) {
              if (attempt === retries) {
                error = `Webhook error: ${(e as Error).message}`;
              }
            }
          }

          const latencyMs = Date.now() - caseStart;
          totalLatency += latencyMs;

          // Score the response
          let finalScore: ScoreResult;
          if (error || !webhookResponse) {
            finalScore = {
              score: 0,
              passed: false,
              scorerType: config.scorers[0]?.type ?? 'exact_match',
              reasoning: error ?? 'No webhook response',
            };
          } else {
            finalScore = await this.scoreResponse(testCase, webhookResponse.output, config);
          }

          // Apply pass threshold
          const passed = finalScore.score >= passThreshold;
          finalScore.passed = passed;

          if (passed) passedCases++;
          else failedCases++;
          totalScore += finalScore.score;

          // Save result
          this.evalStore.saveResult({
            runId,
            testCaseId: testCase.id,
            tenantId,
            sessionId: webhookResponse?.sessionId,
            actualOutput: webhookResponse?.output,
            score: finalScore.score,
            passed,
            scorerType: finalScore.scorerType,
            scorerDetails: finalScore,
            latencyMs,
            costUsd: webhookResponse?.metadata?.costUsd as number | undefined,
            tokenCount: webhookResponse?.metadata?.tokenCount as number | undefined,
            error,
          });

          if (webhookResponse?.metadata?.costUsd) {
            totalCost += webhookResponse.metadata.costUsd as number;
          }
        } finally {
          semaphore.release();
        }
      });

      await Promise.all(promises);

      if (this.cancelledRuns.has(runId)) {
        this.cancelledRuns.delete(runId);
        return;
      }

      // Complete
      const completedAt = new Date().toISOString();
      const total = testCases.length;
      this.evalStore.updateRunStatus(runId, 'completed', {
        totalCases: total,
        passedCases,
        failedCases,
        avgScore: total > 0 ? totalScore / total : 0,
        totalCostUsd: totalCost || undefined,
        totalDurationMs: totalLatency,
        completedAt,
      });
    } catch (err) {
      this.evalStore.updateRunStatus(
        runId,
        'failed',
        { completedAt: new Date().toISOString() },
        `Runner error: ${(err as Error).message}`,
      );
    }
  }

  cancel(runId: string): void {
    this.cancelledRuns.add(runId);
  }

  private async callWebhook(runId: string, testCase: EvalTestCase, webhookUrl: string, timeoutMs: number): Promise<EvalWebhookResponse> {
    const body: EvalWebhookRequest = {
      evalRunId: runId,
      testCaseId: testCase.id,
      input: testCase.input,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchFn(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as EvalWebhookResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async scoreResponse(testCase: EvalTestCase, actualOutput: unknown, config: EvalRunConfig): Promise<ScoreResult> {
    if (!config.scorers || config.scorers.length === 0) {
      return { score: 1.0, passed: true, scorerType: 'exact_match', reasoning: 'No scorers configured' };
    }

    // If single scorer, use it directly
    if (config.scorers.length === 1) {
      const ctx: ScorerContext = {
        testCase,
        actualOutput,
        config: config.scorers[0]!,
      };
      return this.scorerRegistry.score(ctx);
    }

    // Multiple scorers — weighted average
    let totalWeight = 0;
    let weightedScore = 0;
    const subScores: ScoreResult[] = [];

    for (const scorerConfig of config.scorers) {
      const weight = scorerConfig.weight ?? 1.0;
      const ctx: ScorerContext = { testCase, actualOutput, config: scorerConfig };
      const result = await this.scorerRegistry.score(ctx);
      subScores.push(result);
      weightedScore += result.score * weight;
      totalWeight += weight;
    }

    const avgScore = totalWeight > 0 ? weightedScore / totalWeight : 0;

    return {
      score: avgScore,
      passed: avgScore >= (config.passThreshold ?? 0.7),
      scorerType: 'composite',
      reasoning: `Composite score from ${config.scorers.length} scorers`,
      subScores,
    };
  }
}
