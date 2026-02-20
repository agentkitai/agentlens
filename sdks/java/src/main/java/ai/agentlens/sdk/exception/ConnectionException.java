package ai.agentlens.sdk.exception;

/** Thrown when the server is unreachable or a network error occurs. */
public class ConnectionException extends AgentLensException {
    public ConnectionException(String message) {
        super(message, 0, "CONNECTION_ERROR");
    }
    public ConnectionException(String message, Throwable cause) {
        super(message, cause, 0, "CONNECTION_ERROR");
    }
}
