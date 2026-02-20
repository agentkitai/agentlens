# AgentLens Java SDK

Java SDK for the [AgentLens](https://github.com/agentkitai/agentlens) AI agent observability platform.

## Requirements

- Java 17+
- No mandatory dependencies beyond Jackson (included)

## Installation

### Gradle

```kotlin
dependencies {
    implementation("ai.agentlens:agentlens-sdk:0.1.0")
}
```

### Maven

```xml
<dependency>
    <groupId>ai.agentlens</groupId>
    <artifactId>agentlens-sdk</artifactId>
    <version>0.1.0</version>
</dependency>
```

## Quick Start

```java
import ai.agentlens.sdk.*;
import ai.agentlens.sdk.model.*;

// Create client
AgentLensClient client = AgentLensClient.builder()
    .url("http://localhost:3400")
    .apiKey("your-api-key")
    .build();

// Or from environment variables
AgentLensClient client = AgentLensClient.fromEnv();

// Check server health
HealthResult health = client.health();
System.out.println("Server: " + health.getStatus());

// Log an LLM call
String callId = client.logLlmCall("session-1", "agent-1",
    new LogLlmCallParams()
        .setProvider("openai")
        .setModel("gpt-4")
        .setMessages(List.of(new LogLlmCallParams.LlmMessage("user", "Hello")))
        .setCompletion("Hi there!")
        .setFinishReason("stop")
        .setUsage(new LogLlmCallParams.Usage(10, 5, 15))
        .setCostUsd(0.001)
        .setLatencyMs(200));

// Query events
EventQueryResult events = client.queryEvents(
    new EventQuery().setSessionId("session-1"));

// Clean up
client.close();
```

## Configuration

```java
AgentLensClient client = AgentLensClient.builder()
    .url("http://localhost:3400")
    .apiKey("your-api-key")
    .timeout(Duration.ofSeconds(30))
    .retry(new RetryConfig(3, Duration.ofSeconds(1), Duration.ofSeconds(30)))
    .build();
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `AGENTLENS_SERVER_URL` | Base URL (default: `http://localhost:3400`) |
| `AGENTLENS_API_KEY` | Bearer token for authentication |
| `AGENTLENS_BUFFER_DIR` | Disk buffer directory for BatchSender |

## Error Handling

All exceptions extend `AgentLensException` (unchecked):

```java
try {
    client.getEvent("nonexistent");
} catch (NotFoundException e) {
    System.out.println("Not found: " + e.getMessage());
} catch (AuthenticationException e) {
    System.out.println("Auth failed: " + e.getMessage());
} catch (RateLimitException e) {
    System.out.println("Rate limited, retry after: " + e.getRetryAfter());
} catch (AgentLensException e) {
    System.out.println("Error: " + e.getStatus() + " " + e.getMessage());
}
```

## Async API

Every method has an async variant returning `CompletableFuture<T>`:

```java
client.queryEventsAsync(new EventQuery())
    .thenAccept(result -> System.out.println("Events: " + result.getTotal()))
    .exceptionally(e -> { System.err.println(e); return null; });
```

## Fail-Open Mode

For fire-and-forget telemetry, enable fail-open mode:

```java
AgentLensClient client = AgentLensClient.builder()
    .url("http://localhost:3400")
    .apiKey("key")
    .failOpen(e -> logger.warn("AgentLens error: " + e.getMessage()))
    .build();
```

## BatchSender

For high-throughput event ingestion:

```java
BatchSender sender = new BatchSender(
    events -> {
        // send events to AgentLens
        return CompletableFuture.completedFuture(null);
    },
    new BatchSenderOptions()
        .setMaxBatchSize(100)
        .setFlushInterval(Duration.ofSeconds(5))
);

sender.enqueue(event);

// On shutdown
sender.shutdown(Duration.ofSeconds(30)).join();
```

## API Methods

| Category | Methods |
|----------|---------|
| Events | `queryEvents`, `getEvent` |
| Sessions | `getSessions`, `getSession`, `getSessionTimeline` |
| Agents | `getAgent` |
| LLM | `logLlmCall`, `getLlmAnalytics` |
| Recall | `recall` |
| Reflect | `reflect` |
| Context | `getContext` |
| Health | `health`, `getHealth`, `getHealthOverview`, `getHealthHistory` |
| Optimization | `getOptimizationRecommendations` |
| Guardrails | `listGuardrails`, `getGuardrail`, `createGuardrail`, `updateGuardrail`, `deleteGuardrail`, `enableGuardrail`, `disableGuardrail`, `getGuardrailHistory`, `getGuardrailStatus` |
| Audit | `verifyAudit` |

## License

MIT
