package ai.agentlens.sdk.exception;

/**
 * Base exception for all AgentLens SDK errors.
 */
public class AgentLensException extends RuntimeException {
    private final int status;
    private final String code;
    private final Object details;

    public AgentLensException(String message, int status, String code, Object details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }

    public AgentLensException(String message, int status, String code) {
        this(message, status, code, null);
    }

    public AgentLensException(String message, Throwable cause, int status, String code) {
        super(message, cause);
        this.status = status;
        this.code = code;
        this.details = null;
    }

    public int getStatus() { return status; }
    public String getCode() { return code; }
    public Object getDetails() { return details; }
}
