package ai.agentlens.sdk.exception;

/** Thrown when the server returns 400 Bad Request. */
public class ValidationException extends AgentLensException {
    public ValidationException(String message, Object details) {
        super(message, 400, "VALIDATION_ERROR", details);
    }
    public ValidationException(String message) {
        this(message, null);
    }
}
