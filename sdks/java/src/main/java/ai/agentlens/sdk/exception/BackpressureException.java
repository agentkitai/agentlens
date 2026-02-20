package ai.agentlens.sdk.exception;

/** Thrown when the server signals backpressure (503). */
public class BackpressureException extends AgentLensException {
    public BackpressureException(String message) {
        super(message, 503, "BACKPRESSURE");
    }
    public BackpressureException() {
        this("Service unavailable (backpressure)");
    }
}
