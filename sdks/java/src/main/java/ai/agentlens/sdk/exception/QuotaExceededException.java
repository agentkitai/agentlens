package ai.agentlens.sdk.exception;

/** Thrown when the account quota is exceeded (402). */
public class QuotaExceededException extends AgentLensException {
    public QuotaExceededException(String message) {
        super(message, 402, "QUOTA_EXCEEDED");
    }
    public QuotaExceededException() {
        this("Quota exceeded");
    }
}
