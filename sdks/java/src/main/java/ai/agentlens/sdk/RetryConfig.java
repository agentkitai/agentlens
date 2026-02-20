package ai.agentlens.sdk;

import java.time.Duration;

/**
 * Retry configuration for the AgentLens client.
 * <p>
 * Backoff formula: {@code min(base × 2^attempt + random(0, base), max)}
 */
public class RetryConfig {
    private final int maxRetries;
    private final Duration backoffBase;
    private final Duration backoffMax;

    public RetryConfig(int maxRetries, Duration backoffBase, Duration backoffMax) {
        this.maxRetries = maxRetries;
        this.backoffBase = backoffBase;
        this.backoffMax = backoffMax;
    }

    /** Default retry config: 3 retries, 1s base, 30s max. */
    public static RetryConfig defaults() {
        return new RetryConfig(3, Duration.ofSeconds(1), Duration.ofSeconds(30));
    }

    /** No retries. */
    public static RetryConfig noRetry() {
        return new RetryConfig(0, Duration.ZERO, Duration.ZERO);
    }

    public int getMaxRetries() { return maxRetries; }
    public Duration getBackoffBase() { return backoffBase; }
    public Duration getBackoffMax() { return backoffMax; }
}
