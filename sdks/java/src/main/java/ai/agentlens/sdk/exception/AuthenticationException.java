package ai.agentlens.sdk.exception;

/** Thrown when the server returns 401 Unauthorized. */
public class AuthenticationException extends AgentLensException {
    public AuthenticationException(String message) {
        super(message, 401, "AUTHENTICATION_ERROR");
    }
    public AuthenticationException() {
        this("Authentication failed");
    }
}
