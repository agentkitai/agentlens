package ai.agentlens.sdk;

import ai.agentlens.sdk.exception.*;
import ai.agentlens.sdk.model.*;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * Java SDK client for the AgentLens AI agent observability platform.
 *
 * <p>Provides sync and async methods for all AgentLens API endpoints.
 * Use {@link #builder()} or {@link #fromEnv()} to create instances.
 *
 * <p>Implements {@link AutoCloseable} for use with try-with-resources.
 */
public class AgentLensClient implements AutoCloseable {

    private static final Set<Integer> NON_RETRYABLE = Set.of(400, 401, 402, 404);

    private final String baseUrl;
    private final String apiKey;
    private final Duration timeout;
    private final RetryConfig retry;
    private final boolean failOpen;
    private final Consumer<Exception> onError;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    AgentLensClient(AgentLensClientBuilder b) {
        this.baseUrl = b.url.endsWith("/") ? b.url.substring(0, b.url.length() - 1) : b.url;
        this.apiKey = b.apiKey;
        this.timeout = b.timeout;
        this.retry = b.retry;
        this.failOpen = b.failOpen;
        this.onError = b.onError != null ? b.onError : e -> System.err.println("AgentLens error: " + e.getMessage());
        this.objectMapper = b.objectMapper != null ? b.objectMapper : createDefaultMapper();
        this.httpClient = b.httpClient != null ? b.httpClient : HttpClient.newBuilder()
                .connectTimeout(timeout)
                .build();
    }

    private static ObjectMapper createDefaultMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        return mapper;
    }

    /** Create a new builder. */
    public static AgentLensClientBuilder builder() {
        return new AgentLensClientBuilder();
    }

    /**
     * Create a client from environment variables.
     * Reads {@code AGENTLENS_SERVER_URL} and {@code AGENTLENS_API_KEY}.
     */
    public static AgentLensClient fromEnv() {
        String url = System.getenv("AGENTLENS_SERVER_URL");
        String key = System.getenv("AGENTLENS_API_KEY");
        return builder()
                .url(url != null ? url : "http://localhost:3400")
                .apiKey(key)
                .build();
    }

    @Override
    public void close() {
        // HttpClient doesn't need explicit close in Java 17
    }

    // ─── Events ────────────────────────────────────────────────

    /** Query events with optional filters. */
    public EventQueryResult queryEvents(EventQuery query) {
        String qs = query != null ? query.toQueryString() : "";
        return get("/api/events", qs, new TypeReference<>() {});
    }

    /** Query events (async). */
    public CompletableFuture<EventQueryResult> queryEventsAsync(EventQuery query) {
        return CompletableFuture.supplyAsync(() -> queryEvents(query));
    }

    /** Get a single event by ID. */
    public Event getEvent(String id) {
        return get("/api/events/" + encode(id), "", new TypeReference<>() {});
    }

    public CompletableFuture<Event> getEventAsync(String id) {
        return CompletableFuture.supplyAsync(() -> getEvent(id));
    }

    // ─── Sessions ──────────────────────────────────────────────

    /** Query sessions. */
    public SessionQueryResult getSessions(SessionQuery query) {
        String qs = query != null ? query.toQueryString() : "";
        return get("/api/sessions", qs, new TypeReference<>() {});
    }

    public CompletableFuture<SessionQueryResult> getSessionsAsync(SessionQuery query) {
        return CompletableFuture.supplyAsync(() -> getSessions(query));
    }

    /** Get a single session by ID. */
    public Session getSession(String id) {
        return get("/api/sessions/" + encode(id), "", new TypeReference<>() {});
    }

    public CompletableFuture<Session> getSessionAsync(String id) {
        return CompletableFuture.supplyAsync(() -> getSession(id));
    }

    /** Get session timeline. */
    public TimelineResult getSessionTimeline(String id) {
        return get("/api/sessions/" + encode(id) + "/timeline", "", new TypeReference<>() {});
    }

    public CompletableFuture<TimelineResult> getSessionTimelineAsync(String id) {
        return CompletableFuture.supplyAsync(() -> getSessionTimeline(id));
    }

    // ─── Agents ────────────────────────────────────────────────

    /** Get an agent by ID. */
    public Agent getAgent(String id) {
        return get("/api/agents/" + encode(id), "", new TypeReference<>() {});
    }

    public CompletableFuture<Agent> getAgentAsync(String id) {
        return CompletableFuture.supplyAsync(() -> getAgent(id));
    }

    // ─── LLM Tracking ─────────────────────────────────────────

    /**
     * Log an LLM call. Returns the generated call ID.
     */
    public String logLlmCall(String sessionId, String agentId, LogLlmCallParams params) {
        String callId = UUID.randomUUID().toString();
        String timestamp = Instant.now().toString();

        Map<String, Object> llmCallPayload = new LinkedHashMap<>();
        llmCallPayload.put("callId", callId);
        llmCallPayload.put("provider", params.getProvider());
        llmCallPayload.put("model", params.getModel());
        llmCallPayload.put("messages", params.getMessages());
        if (params.getSystemPrompt() != null) llmCallPayload.put("systemPrompt", params.getSystemPrompt());
        if (params.getParameters() != null) llmCallPayload.put("parameters", params.getParameters());
        if (params.getTools() != null) llmCallPayload.put("tools", params.getTools());

        Map<String, Object> llmResponsePayload = new LinkedHashMap<>();
        llmResponsePayload.put("callId", callId);
        llmResponsePayload.put("completion", params.getCompletion());
        llmResponsePayload.put("finishReason", params.getFinishReason());
        llmResponsePayload.put("usage", params.getUsage());
        llmResponsePayload.put("costUsd", params.getCostUsd());
        llmResponsePayload.put("latencyMs", params.getLatencyMs());
        if (params.getToolCalls() != null) llmResponsePayload.put("toolCalls", params.getToolCalls());

        Map<String, Object> callEvent = new LinkedHashMap<>();
        callEvent.put("sessionId", sessionId);
        callEvent.put("agentId", agentId);
        callEvent.put("eventType", "llm_call");
        callEvent.put("severity", "info");
        callEvent.put("payload", llmCallPayload);
        callEvent.put("metadata", Map.of());
        callEvent.put("timestamp", timestamp);

        Map<String, Object> responseEvent = new LinkedHashMap<>();
        responseEvent.put("sessionId", sessionId);
        responseEvent.put("agentId", agentId);
        responseEvent.put("eventType", "llm_response");
        responseEvent.put("severity", "info");
        responseEvent.put("payload", llmResponsePayload);
        responseEvent.put("metadata", Map.of());
        responseEvent.put("timestamp", timestamp);

        Map<String, Object> body = Map.of("events", List.of(callEvent, responseEvent));
        request("POST", "/api/events", body, new TypeReference<Map<String, Object>>() {}, false);
        return callId;
    }

    public CompletableFuture<String> logLlmCallAsync(String sessionId, String agentId, LogLlmCallParams params) {
        return CompletableFuture.supplyAsync(() -> logLlmCall(sessionId, agentId, params));
    }

    /** Get LLM analytics. */
    public LlmAnalyticsResult getLlmAnalytics(LlmAnalyticsParams params) {
        String qs = params != null ? params.toQueryString() : "";
        return get("/api/analytics/llm", qs, new TypeReference<>() {});
    }

    public CompletableFuture<LlmAnalyticsResult> getLlmAnalyticsAsync(LlmAnalyticsParams params) {
        return CompletableFuture.supplyAsync(() -> getLlmAnalytics(params));
    }

    // ─── Recall ────────────────────────────────────────────────

    /** Semantic search over embeddings. */
    public RecallResult recall(RecallQuery query) {
        return get("/api/recall", query.toQueryString(), new TypeReference<>() {});
    }

    public CompletableFuture<RecallResult> recallAsync(RecallQuery query) {
        return CompletableFuture.supplyAsync(() -> recall(query));
    }

    // ─── Reflect ───────────────────────────────────────────────

    /** Analyze patterns across sessions. */
    public ReflectResult reflect(ReflectQuery query) {
        return get("/api/reflect", query.toQueryString(), new TypeReference<>() {});
    }

    public CompletableFuture<ReflectResult> reflectAsync(ReflectQuery query) {
        return CompletableFuture.supplyAsync(() -> reflect(query));
    }

    // ─── Context ───────────────────────────────────────────────

    /** Get cross-session context. */
    public ContextResult getContext(ContextQuery query) {
        return get("/api/context", query.toQueryString(), new TypeReference<>() {});
    }

    public CompletableFuture<ContextResult> getContextAsync(ContextQuery query) {
        return CompletableFuture.supplyAsync(() -> getContext(query));
    }

    // ─── Health ────────────────────────────────────────────────

    /** Check server health (no auth required). */
    public HealthResult health() {
        return request("GET", "/api/health", null, new TypeReference<>() {}, true);
    }

    public CompletableFuture<HealthResult> healthAsync() {
        return CompletableFuture.supplyAsync(this::health);
    }

    /** Get health score for a single agent. */
    public HealthScore getHealth(String agentId, Integer window) {
        StringBuilder qs = new StringBuilder();
        if (window != null) qs.append("window=").append(window);
        return get("/api/agents/" + encode(agentId) + "/health", qs.toString(), new TypeReference<>() {});
    }

    public CompletableFuture<HealthScore> getHealthAsync(String agentId, Integer window) {
        return CompletableFuture.supplyAsync(() -> getHealth(agentId, window));
    }

    /** Get health overview for all agents. */
    public List<HealthScore> getHealthOverview(Integer window) {
        StringBuilder qs = new StringBuilder();
        if (window != null) qs.append("window=").append(window);
        return get("/api/health/overview", qs.toString(), new TypeReference<>() {});
    }

    public CompletableFuture<List<HealthScore>> getHealthOverviewAsync(Integer window) {
        return CompletableFuture.supplyAsync(() -> getHealthOverview(window));
    }

    /** Get historical health snapshots. */
    public List<HealthSnapshot> getHealthHistory(String agentId, Integer days) {
        StringBuilder qs = new StringBuilder();
        qs.append("agentId=").append(encode(agentId));
        if (days != null) qs.append("&days=").append(days);
        return get("/api/health/history", qs.toString(), new TypeReference<>() {});
    }

    public CompletableFuture<List<HealthSnapshot>> getHealthHistoryAsync(String agentId, Integer days) {
        return CompletableFuture.supplyAsync(() -> getHealthHistory(agentId, days));
    }

    // ─── Optimization ──────────────────────────────────────────

    /** Get cost optimization recommendations. */
    public OptimizationResult getOptimizationRecommendations(OptimizationOptions opts) {
        String qs = opts != null ? opts.toQueryString() : "";
        return get("/api/optimize/recommendations", qs, new TypeReference<>() {});
    }

    public CompletableFuture<OptimizationResult> getOptimizationRecommendationsAsync(OptimizationOptions opts) {
        return CompletableFuture.supplyAsync(() -> getOptimizationRecommendations(opts));
    }

    // ─── Guardrails ────────────────────────────────────────────

    /** List guardrail rules. */
    public GuardrailRuleListResult listGuardrails(GuardrailListOptions opts) {
        String qs = opts != null ? opts.toQueryString() : "";
        return get("/api/guardrails", qs, new TypeReference<>() {});
    }

    public CompletableFuture<GuardrailRuleListResult> listGuardrailsAsync(GuardrailListOptions opts) {
        return CompletableFuture.supplyAsync(() -> listGuardrails(opts));
    }

    /** Get a single guardrail rule. */
    public GuardrailRule getGuardrail(String id) {
        return get("/api/guardrails/" + encode(id), "", new TypeReference<>() {});
    }

    public CompletableFuture<GuardrailRule> getGuardrailAsync(String id) {
        return CompletableFuture.supplyAsync(() -> getGuardrail(id));
    }

    /** Create a guardrail rule. */
    public GuardrailRule createGuardrail(CreateGuardrailParams params) {
        return request("POST", "/api/guardrails", params, new TypeReference<>() {}, false);
    }

    public CompletableFuture<GuardrailRule> createGuardrailAsync(CreateGuardrailParams params) {
        return CompletableFuture.supplyAsync(() -> createGuardrail(params));
    }

    /** Update a guardrail rule. */
    public GuardrailRule updateGuardrail(String id, UpdateGuardrailParams params) {
        return request("PUT", "/api/guardrails/" + encode(id), params, new TypeReference<>() {}, false);
    }

    public CompletableFuture<GuardrailRule> updateGuardrailAsync(String id, UpdateGuardrailParams params) {
        return CompletableFuture.supplyAsync(() -> updateGuardrail(id, params));
    }

    /** Delete a guardrail rule. */
    public void deleteGuardrail(String id) {
        request("DELETE", "/api/guardrails/" + encode(id), null, new TypeReference<Map<String, Object>>() {}, false);
    }

    public CompletableFuture<Void> deleteGuardrailAsync(String id) {
        return CompletableFuture.runAsync(() -> deleteGuardrail(id));
    }

    /** Enable a guardrail rule. */
    public GuardrailRule enableGuardrail(String id) {
        return updateGuardrail(id, new UpdateGuardrailParams().setEnabled(true));
    }

    public CompletableFuture<GuardrailRule> enableGuardrailAsync(String id) {
        return CompletableFuture.supplyAsync(() -> enableGuardrail(id));
    }

    /** Disable a guardrail rule. */
    public GuardrailRule disableGuardrail(String id) {
        return updateGuardrail(id, new UpdateGuardrailParams().setEnabled(false));
    }

    public CompletableFuture<GuardrailRule> disableGuardrailAsync(String id) {
        return CompletableFuture.supplyAsync(() -> disableGuardrail(id));
    }

    /** Get guardrail trigger history. */
    public GuardrailTriggerHistoryResult getGuardrailHistory(GuardrailHistoryOptions opts) {
        String qs = opts != null ? opts.toQueryString() : "";
        return get("/api/guardrails/history", qs, new TypeReference<>() {});
    }

    public CompletableFuture<GuardrailTriggerHistoryResult> getGuardrailHistoryAsync(GuardrailHistoryOptions opts) {
        return CompletableFuture.supplyAsync(() -> getGuardrailHistory(opts));
    }

    /** Get guardrail status with recent triggers. */
    public GuardrailStatusResult getGuardrailStatus(String id) {
        return get("/api/guardrails/" + encode(id) + "/status", "", new TypeReference<>() {});
    }

    public CompletableFuture<GuardrailStatusResult> getGuardrailStatusAsync(String id) {
        return CompletableFuture.supplyAsync(() -> getGuardrailStatus(id));
    }

    // ─── Audit ─────────────────────────────────────────────────

    /** Verify audit trail hash chain integrity. */
    public VerificationReport verifyAudit(VerifyAuditParams params) {
        String qs = params != null ? params.toQueryString() : "";
        return get("/api/audit/verify", qs, new TypeReference<>() {});
    }

    public CompletableFuture<VerificationReport> verifyAuditAsync(VerifyAuditParams params) {
        return CompletableFuture.supplyAsync(() -> verifyAudit(params));
    }

    // ─── Internal ──────────────────────────────────────────────

    private <T> T get(String path, String queryString, TypeReference<T> type) {
        String fullPath = queryString != null && !queryString.isEmpty() ? path + "?" + queryString : path;
        return request("GET", fullPath, null, type, false);
    }

    private <T> T request(String method, String path, Object body, TypeReference<T> type, boolean skipAuth) {
        try {
            return requestWithRetry(method, path, body, type, skipAuth);
        } catch (Exception e) {
            if (failOpen) {
                onError.accept(e);
                return null;
            }
            if (e instanceof RuntimeException re) throw re;
            throw new AgentLensException(e.getMessage(), e, 0, "UNKNOWN");
        }
    }

    private <T> T requestWithRetry(String method, String path, Object body, TypeReference<T> type, boolean skipAuth) {
        int maxRetries = retry.getMaxRetries();
        Exception lastError = null;

        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            if (attempt > 0 && lastError != null) {
                long delayMs;
                if (lastError instanceof RateLimitException rle && rle.getRetryAfter() != null) {
                    delayMs = (long) (rle.getRetryAfter() * 1000);
                } else {
                    delayMs = calculateBackoff(attempt - 1);
                }
                try {
                    Thread.sleep(delayMs);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new ConnectionException("Request interrupted");
                }
            }

            HttpResponse<String> response;
            try {
                HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                        .uri(URI.create(baseUrl + path))
                        .timeout(timeout)
                        .header("Accept", "application/json");

                if (!skipAuth && apiKey != null) {
                    reqBuilder.header("Authorization", "Bearer " + apiKey);
                }

                if (body != null) {
                    String json = objectMapper.writeValueAsString(body);
                    reqBuilder.header("Content-Type", "application/json");
                    reqBuilder.method(method, HttpRequest.BodyPublishers.ofString(json));
                } else {
                    reqBuilder.method(method, HttpRequest.BodyPublishers.noBody());
                }

                response = httpClient.send(reqBuilder.build(), HttpResponse.BodyHandlers.ofString());
            } catch (IOException e) {
                lastError = new ConnectionException("Failed to connect to AgentLens at " + baseUrl + ": " + e.getMessage(), e);
                continue;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new ConnectionException("Request interrupted");
            }

            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                try {
                    String responseBody = response.body();
                    if (responseBody == null || responseBody.isEmpty()) return null;
                    return objectMapper.readValue(responseBody, type);
                } catch (Exception e) {
                    throw new AgentLensException("Failed to parse response: " + e.getMessage(), e, response.statusCode(), "PARSE_ERROR");
                }
            }

            // Parse error
            String errorMessage;
            Object details = null;
            try {
                JsonNode node = objectMapper.readTree(response.body());
                errorMessage = node.has("error") ? node.get("error").asText() : "HTTP " + response.statusCode();
                if (node.has("details")) details = node.get("details");
            } catch (Exception e) {
                errorMessage = response.body() != null && !response.body().isEmpty()
                        ? response.body() : "HTTP " + response.statusCode();
            }

            // Non-retryable
            if (NON_RETRYABLE.contains(response.statusCode())) {
                throw switch (response.statusCode()) {
                    case 401 -> new AuthenticationException(errorMessage);
                    case 404 -> new NotFoundException(errorMessage);
                    case 400 -> new ValidationException(errorMessage, details);
                    case 402 -> new QuotaExceededException(errorMessage);
                    default -> new AgentLensException(errorMessage, response.statusCode(), "API_ERROR");
                };
            }

            // Retryable
            if (response.statusCode() == 429) {
                String retryAfterHeader = response.headers().firstValue("Retry-After").orElse(null);
                Double retryAfter = null;
                if (retryAfterHeader != null) {
                    try { retryAfter = Double.parseDouble(retryAfterHeader); } catch (NumberFormatException ignored) {}
                }
                lastError = new RateLimitException(errorMessage, retryAfter);
                continue;
            }

            if (response.statusCode() == 503) {
                lastError = new BackpressureException(errorMessage);
                continue;
            }

            // Other errors — not retryable
            throw new AgentLensException(errorMessage, response.statusCode(), "API_ERROR");
        }

        // All retries exhausted
        if (lastError instanceof RuntimeException re) throw re;
        throw new ConnectionException("Request failed after " + (maxRetries + 1) + " attempts: " +
                (lastError != null ? lastError.getMessage() : "unknown error"));
    }

    private long calculateBackoff(int attempt) {
        long baseMs = retry.getBackoffBase().toMillis();
        long maxMs = retry.getBackoffMax().toMillis();
        long delay = (long) (baseMs * Math.pow(2, attempt) + ThreadLocalRandom.current().nextLong(baseMs));
        return Math.min(delay, maxMs);
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
