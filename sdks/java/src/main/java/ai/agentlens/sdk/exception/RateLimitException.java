package ai.agentlens.sdk.exception;

/** Thrown when the server returns 429 Too Many Requests. */
public class RateLimitException extends AgentLensException {
    private final Double retryAfter;

    public RateLimitException(String message, Double retryAfter) {
        super(message, 429, "RATE_LIMIT");
        this.retryAfter = retryAfter;
    }
    public RateLimitException(String message) {
        this(message, null);
    }
    public RateLimitException() {
        this("Rate limit exceeded", null);
    }

    /** Seconds to wait before retrying, or null if not specified. */
    public Double getRetryAfter() { return retryAfter; }
}
