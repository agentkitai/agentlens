package ai.agentlens.sdk.exception;

/** Thrown when the server returns 404 Not Found. */
public class NotFoundException extends AgentLensException {
    public NotFoundException(String message) {
        super(message, 404, "NOT_FOUND");
    }
}
