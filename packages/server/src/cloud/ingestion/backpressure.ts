/**
 * Backpressure Mechanism (S-3.5)
 *
 * Monitors Redis Stream length. When pending messages exceed a configurable
 * threshold (default 100K, env: BACKPRESSURE_THRESHOLD), the API gateway
 * returns 503 with Retry-After header.
 *
 * Includes CloudWatch alarm configuration and auto-scaling policy definitions.
 */

import type { EventQueue } from './event-queue.js';
import { BACKPRESSURE_THRESHOLD } from './event-queue.js';

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface BackpressureStatus {
  /** Whether the system is under backpressure */
  underPressure: boolean;
  /** Current stream depth */
  streamLength: number;
  /** Configured threshold */
  threshold: number;
  /** Suggested Retry-After in seconds (0 if not under pressure) */
  retryAfterSeconds: number;
}

export interface BackpressureConfig {
  /** Pending message threshold (default: from env or 100K) */
  threshold?: number;
  /** Retry-After header value in seconds when under pressure (default: 5) */
  retryAfterSeconds?: number;
  /** Check interval for cached status in ms (default: 1000) */
  cacheMs?: number;
}

export interface CloudWatchAlarmConfig {
  alarmName: string;
  metricName: string;
  namespace: string;
  threshold: number;
  evaluationPeriods: number;
  period: number;
  statistic: string;
  comparisonOperator: string;
  alarmActions: string[];
  dimensions: Array<{ Name: string; Value: string }>;
}

export interface AutoScalingPolicy {
  policyName: string;
  serviceNamespace: string;
  resourceId: string;
  scalableDimension: string;
  stepAdjustments: Array<{
    metricIntervalLowerBound: number;
    metricIntervalUpperBound?: number;
    scalingAdjustment: number;
  }>;
  cooldownSeconds: number;
}

// ═══════════════════════════════════════════
// BackpressureMonitor
// ═══════════════════════════════════════════

/**
 * Monitors queue depth and reports backpressure status.
 * Caches the stream length check to avoid hitting Redis on every request.
 */
export class BackpressureMonitor {
  private threshold: number;
  private retryAfterSeconds: number;
  private cacheMs: number;
  private cachedStatus: BackpressureStatus | null = null;
  private lastCheckTime = 0;

  constructor(
    private queue: EventQueue,
    config?: BackpressureConfig,
  ) {
    // Allow env override
    const envThreshold = typeof process !== 'undefined'
      ? parseInt(process.env.BACKPRESSURE_THRESHOLD ?? '', 10)
      : NaN;

    this.threshold = config?.threshold ?? (isNaN(envThreshold) ? BACKPRESSURE_THRESHOLD : envThreshold);
    this.retryAfterSeconds = config?.retryAfterSeconds ?? 5;
    this.cacheMs = config?.cacheMs ?? 1000;
  }

  /** Get the configured threshold */
  getThreshold(): number {
    return this.threshold;
  }

  /**
   * Check whether the system is under backpressure.
   * Uses a cached value if checked within the cache interval.
   */
  async check(): Promise<BackpressureStatus> {
    const now = Date.now();
    if (this.cachedStatus && (now - this.lastCheckTime) < this.cacheMs) {
      return this.cachedStatus;
    }

    const streamLength = await this.queue.getStreamLength();
    const underPressure = streamLength >= this.threshold;

    this.cachedStatus = {
      underPressure,
      streamLength,
      threshold: this.threshold,
      retryAfterSeconds: underPressure ? this.retryAfterSeconds : 0,
    };
    this.lastCheckTime = now;

    return this.cachedStatus;
  }

  /** Force-clear the cache (useful after scaling or for tests) */
  clearCache(): void {
    this.cachedStatus = null;
    this.lastCheckTime = 0;
  }

  /**
   * Generate a 503 response body for backpressure.
   */
  static make503Response(status: BackpressureStatus): {
    status: 503;
    headers: Record<string, string>;
    body: { error: string; retry_after: number; stream_depth: number };
  } {
    return {
      status: 503,
      headers: {
        'Retry-After': String(status.retryAfterSeconds),
      },
      body: {
        error: 'Service temporarily unavailable due to high load. Please retry.',
        retry_after: status.retryAfterSeconds,
        stream_depth: status.streamLength,
      },
    };
  }
}

// ═══════════════════════════════════════════
// CloudWatch Alarm Configuration
// ═══════════════════════════════════════════

/**
 * Generate CloudWatch alarm configuration for stream depth monitoring.
 */
export function generateCloudWatchAlarmConfig(opts?: {
  threshold?: number;
  snsTopicArn?: string;
  streamName?: string;
}): CloudWatchAlarmConfig {
  const threshold = opts?.threshold ?? BACKPRESSURE_THRESHOLD;
  const snsArn = opts?.snsTopicArn ?? 'arn:aws:sns:us-east-1:ACCOUNT_ID:agentlens-alerts';

  return {
    alarmName: 'AgentLens-IngestionStreamDepth-High',
    metricName: 'StreamPendingMessages',
    namespace: 'AgentLens/Ingestion',
    threshold,
    evaluationPeriods: 2,
    period: 60,
    statistic: 'Average',
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    alarmActions: [snsArn],
    dimensions: [
      { Name: 'StreamName', Value: opts?.streamName ?? 'event_ingestion' },
    ],
  };
}

// ═══════════════════════════════════════════
// Auto-Scaling Policy Configuration
// ═══════════════════════════════════════════

/**
 * Generate auto-scaling step policy for worker tasks.
 * When stream depth exceeds threshold, add workers in steps.
 */
export function generateAutoScalingPolicy(opts?: {
  ecsCluster?: string;
  ecsService?: string;
  cooldownSeconds?: number;
}): AutoScalingPolicy {
  const cluster = opts?.ecsCluster ?? 'agentlens-cloud';
  const service = opts?.ecsService ?? 'ingestion-workers';

  return {
    policyName: 'AgentLens-IngestionWorker-ScaleUp',
    serviceNamespace: 'ecs',
    resourceId: `service/${cluster}/${service}`,
    scalableDimension: 'ecs:service:DesiredCount',
    stepAdjustments: [
      {
        metricIntervalLowerBound: 0,
        metricIntervalUpperBound: 50_000,
        scalingAdjustment: 2,
      },
      {
        metricIntervalLowerBound: 50_000,
        scalingAdjustment: 5,
      },
    ],
    cooldownSeconds: opts?.cooldownSeconds ?? 120,
  };
}
