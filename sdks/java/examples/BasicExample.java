import ai.agentlens.sdk.*;
import ai.agentlens.sdk.model.*;

import java.util.List;

/**
 * Basic example demonstrating AgentLens Java SDK usage.
 *
 * Prerequisites:
 *   - AgentLens server running at http://localhost:3400
 *   - Set AGENTLENS_API_KEY environment variable
 */
public class BasicExample {
    public static void main(String[] args) {
        // Create client from environment variables
        try (AgentLensClient client = AgentLensClient.fromEnv()) {

            // 1. Check server health
            HealthResult health = client.health();
            System.out.println("Server status: " + health.getStatus());
            System.out.println("Server version: " + health.getVersion());

            // 2. Log an LLM call
            String callId = client.logLlmCall("example-session", "example-agent",
                    new LogLlmCallParams()
                            .setProvider("openai")
                            .setModel("gpt-4")
                            .setMessages(List.of(
                                    new LogLlmCallParams.LlmMessage("user", "What is AgentLens?")))
                            .setCompletion("AgentLens is an AI agent observability platform.")
                            .setFinishReason("stop")
                            .setUsage(new LogLlmCallParams.Usage(12, 8, 20))
                            .setCostUsd(0.002)
                            .setLatencyMs(350));
            System.out.println("Logged LLM call: " + callId);

            // 3. Query events for the session
            EventQueryResult events = client.queryEvents(
                    new EventQuery().setSessionId("example-session"));
            System.out.println("Events found: " + events.getTotal());
            for (Event event : events.getEvents()) {
                System.out.println("  - " + event.getEventType() + " (" + event.getId() + ")");
            }

            // 4. Async query
            client.getHealthOverviewAsync(null)
                    .thenAccept(scores -> {
                        System.out.println("Health overview: " + scores.size() + " agents");
                    })
                    .join();

            System.out.println("Done!");
        }
    }
}
