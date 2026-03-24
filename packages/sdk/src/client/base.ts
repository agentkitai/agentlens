/**
 * Base client with fetch helper, auth, config, retry — extracted from client.ts (cq-003)
 */

import type { RetryConfig, AgentLensClientOptions } from './types.js';
import {
  AgentLensError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  ConnectionError,
  RateLimitError,
  QuotaExceededError,
  BackpressureError,
} from '../errors.js';

export class BaseClient {
  protected readonly baseUrl: string;
  protected readonly apiKey?: string;
  protected readonly _fetch: typeof globalThis.fetch;
  protected readonly timeout: number;
  protected readonly retryConfig: Required<RetryConfig>;
  protected readonly failOpen: boolean;
  protected readonly onError: (error: Error) => void;
  protected readonly logger: { warn: (msg: string) => void };

  constructor(options: AgentLensClientOptions) {
    this.baseUrl = options.url.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this._fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeout = options.timeout ?? 30_000;
    this.retryConfig = {
      maxRetries: options.retry?.maxRetries ?? 3,
      backoffBaseMs: options.retry?.backoffBaseMs ?? 1_000,
      backoffMaxMs: options.retry?.backoffMaxMs ?? 30_000,
    };
    this.failOpen = options.failOpen ?? false;
    this.logger = options.logger ?? console;
    this.onError = options.onError ?? ((err: Error) => this.logger.warn(`[AgentLens failOpen] ${err.message}`));
  }

  /** Status codes that must never be retried */
  private static readonly NON_RETRYABLE = new Set([400, 401, 402, 404]);

  /**
   * Calculate backoff delay: min(baseMs * 2^attempt + random(0, baseMs), maxMs)
   */
  private backoffDelay(attempt: number): number {
    const { backoffBaseMs, backoffMaxMs } = this.retryConfig;
    const delay = backoffBaseMs * Math.pow(2, attempt) + Math.random() * backoffBaseMs;
    return Math.min(delay, backoffMaxMs);
  }

  protected async request<T>(
    path: string,
    options: { method?: string; body?: unknown; skipAuth?: boolean } = {},
  ): Promise<T> {
    try {
      return await this._request<T>(path, options);
    } catch (err) {
      if (this.failOpen) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.onError(error);
        return undefined as unknown as T;
      }
      throw err;
    }
  }

  private async _request<T>(
    path: string,
    options: { method?: string; body?: unknown; skipAuth?: boolean } = {},
  ): Promise<T> {
    const { method = 'GET', body, skipAuth = false } = options;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (!skipAuth && this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    if (body != null) {
      headers['Content-Type'] = 'application/json';
    }

    const jsonBody = body != null ? JSON.stringify(body) : undefined;
    const url = `${this.baseUrl}${path}`;
    const { maxRetries } = this.retryConfig;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0 && lastError) {
        let delayMs: number;

        if (
          lastError instanceof RateLimitError &&
          lastError.retryAfter != null
        ) {
          delayMs = lastError.retryAfter * 1_000;
        } else {
          delayMs = this.backoffDelay(attempt - 1);
        }

        await new Promise((r) => setTimeout(r, delayMs));
      }

      let response: Response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeout);
        try {
          response = await this._fetch(url, {
            method,
            headers,
            body: jsonBody,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          lastError = new ConnectionError(
            `Request to ${url} timed out after ${this.timeout}ms`,
          );
          continue;
        }
        lastError = new ConnectionError(
          `Failed to connect to AgentLens at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
        continue;
      }

      if (response.ok) {
        return response.json() as Promise<T>;
      }

      const text = await response.text().catch(() => '');
      let parsed: { error?: string; details?: unknown } | null = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // not JSON
      }
      const message = parsed?.error ?? (text || `HTTP ${response.status}`);

      if (BaseClient.NON_RETRYABLE.has(response.status)) {
        switch (response.status) {
          case 401:
            throw new AuthenticationError(message);
          case 404:
            throw new NotFoundError(message);
          case 400:
            throw new ValidationError(message, parsed?.details);
          case 402:
            throw new QuotaExceededError(message);
        }
      }

      if (response.status === 429) {
        const retryAfterHeader = response.headers?.get?.('Retry-After');
        const retryAfter = retryAfterHeader ? parseFloat(retryAfterHeader) : null;
        lastError = new RateLimitError(message, Number.isFinite(retryAfter) ? retryAfter : null);
        continue;
      }

      if (response.status === 503) {
        lastError = new BackpressureError(message);
        continue;
      }

      throw new AgentLensError(message, response.status, 'API_ERROR', parsed?.details);
    }

    throw lastError!;
  }
}
