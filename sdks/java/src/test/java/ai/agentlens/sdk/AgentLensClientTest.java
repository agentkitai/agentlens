package ai.agentlens.sdk;

import ai.agentlens.sdk.exception.*;
import ai.agentlens.sdk.model.*;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.*;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class AgentLensClientTest {

    private MockWebServer server;
    private AgentLensClient client;

    @BeforeEach
    void setUp() throws Exception {
        server = new MockWebServer();
        server.start();
        client = AgentLensClient.builder()
                .url(server.url("/").toString())
                .apiKey("test-key")
                .retry(RetryConfig.noRetry())
                .build();
    }

    @AfterEach
    void tearDown() throws Exception {
        client.close();
        server.shutdown();
    }

    @Test
    void testHealth() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"status\":\"ok\",\"version\":\"0.12.1\"}")
                .setHeader("Content-Type", "application/json"));

        HealthResult result = client.health();
        assertEquals("ok", result.getStatus());
        assertEquals("0.12.1", result.getVersion());

        RecordedRequest req = server.takeRequest();
        assertEquals("GET", req.getMethod());
        assertEquals("/api/health", req.getPath());
        assertNull(req.getHeader("Authorization"));
    }

    @Test
    void testQueryEvents() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"events\":[],\"total\":0,\"hasMore\":false}")
                .setHeader("Content-Type", "application/json"));

        EventQueryResult result = client.queryEvents(new EventQuery().setSessionId("s1"));
        assertNotNull(result);
        assertEquals(0, result.getTotal());
        assertTrue(result.getEvents().isEmpty());

        RecordedRequest req = server.takeRequest();
        assertTrue(req.getPath().contains("sessionId=s1"));
    }

    @Test
    void testGetEvent() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"id\":\"e1\",\"sessionId\":\"s1\",\"eventType\":\"llm_call\"}")
                .setHeader("Content-Type", "application/json"));

        Event event = client.getEvent("e1");
        assertEquals("e1", event.getId());
        assertEquals("s1", event.getSessionId());
    }

    @Test
    void testGetSessions() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"sessions\":[],\"total\":0,\"hasMore\":false}")
                .setHeader("Content-Type", "application/json"));

        SessionQueryResult result = client.getSessions(new SessionQuery());
        assertEquals(0, result.getTotal());
    }

    @Test
    void testGetSession() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"id\":\"s1\",\"agentId\":\"a1\",\"status\":\"active\"}")
                .setHeader("Content-Type", "application/json"));

        Session session = client.getSession("s1");
        assertEquals("s1", session.getId());
    }

    @Test
    void testGetSessionTimeline() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"events\":[],\"chainValid\":true}")
                .setHeader("Content-Type", "application/json"));

        TimelineResult result = client.getSessionTimeline("s1");
        assertTrue(result.isChainValid());
    }

    @Test
    void testGetAgent() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"id\":\"a1\",\"name\":\"test-agent\"}")
                .setHeader("Content-Type", "application/json"));

        Agent agent = client.getAgent("a1");
        assertEquals("a1", agent.getId());
        assertEquals("test-agent", agent.getName());
    }

    @Test
    void testLogLlmCall() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{}")
                .setHeader("Content-Type", "application/json"));

        LogLlmCallParams params = new LogLlmCallParams()
                .setProvider("openai")
                .setModel("gpt-4")
                .setMessages(List.of(new LogLlmCallParams.LlmMessage("user", "hello")))
                .setCompletion("Hi there!")
                .setFinishReason("stop")
                .setUsage(new LogLlmCallParams.Usage(10, 5, 15))
                .setCostUsd(0.001)
                .setLatencyMs(200);

        String callId = client.logLlmCall("s1", "a1", params);
        assertNotNull(callId);
        assertFalse(callId.isEmpty());

        RecordedRequest req = server.takeRequest();
        assertEquals("POST", req.getMethod());
        assertEquals("/api/events", req.getPath());
        assertTrue(req.getBody().readUtf8().contains("llm_call"));
    }

    @Test
    void testGetLlmAnalytics() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"summary\":{\"totalCalls\":10},\"byModel\":[],\"byTime\":[]}")
                .setHeader("Content-Type", "application/json"));

        LlmAnalyticsResult result = client.getLlmAnalytics(new LlmAnalyticsParams().setModel("gpt-4"));
        assertEquals(10, result.getSummary().getTotalCalls());
    }

    @Test
    void testRecall() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"matches\":[],\"total\":0}")
                .setHeader("Content-Type", "application/json"));

        RecallResult result = client.recall(new RecallQuery().setQuery("test"));
        assertEquals(0, result.getTotal());
    }

    @Test
    void testReflect() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"patterns\":[],\"summary\":{}}")
                .setHeader("Content-Type", "application/json"));

        ReflectResult result = client.reflect(new ReflectQuery().setAnalysis("errors"));
        assertNotNull(result);
    }

    @Test
    void testGetContext() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"context\":[],\"summary\":{}}")
                .setHeader("Content-Type", "application/json"));

        ContextResult result = client.getContext(new ContextQuery().setTopic("test"));
        assertNotNull(result);
    }

    @Test
    void testGetHealth() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"agentId\":\"a1\",\"score\":0.95,\"status\":\"healthy\"}")
                .setHeader("Content-Type", "application/json"));

        HealthScore score = client.getHealth("a1", null);
        assertEquals(0.95, score.getScore(), 0.01);
    }

    @Test
    void testGetHealthOverview() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("[{\"agentId\":\"a1\",\"score\":0.9}]")
                .setHeader("Content-Type", "application/json"));

        List<HealthScore> scores = client.getHealthOverview(null);
        assertEquals(1, scores.size());
    }

    @Test
    void testGetHealthHistory() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("[{\"agentId\":\"a1\",\"score\":0.8}]")
                .setHeader("Content-Type", "application/json"));

        List<HealthSnapshot> snapshots = client.getHealthHistory("a1", 7);
        assertEquals(1, snapshots.size());
    }

    @Test
    void testGetOptimizationRecommendations() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"recommendations\":[],\"summary\":{}}")
                .setHeader("Content-Type", "application/json"));

        OptimizationResult result = client.getOptimizationRecommendations(null);
        assertNotNull(result);
    }

    @Test
    void testListGuardrails() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"rules\":[]}")
                .setHeader("Content-Type", "application/json"));

        GuardrailRuleListResult result = client.listGuardrails(null);
        assertNotNull(result.getRules());
    }

    @Test
    void testCreateGuardrail() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"id\":\"g1\",\"name\":\"test-rule\",\"enabled\":true}")
                .setHeader("Content-Type", "application/json"));

        GuardrailRule rule = client.createGuardrail(new CreateGuardrailParams().setName("test-rule"));
        assertEquals("g1", rule.getId());
    }

    @Test
    void testDeleteGuardrail() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"ok\":true}")
                .setHeader("Content-Type", "application/json"));

        assertDoesNotThrow(() -> client.deleteGuardrail("g1"));
    }

    @Test
    void testVerifyAudit() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"verified\":true,\"sessionsVerified\":5,\"totalEvents\":100,\"brokenChains\":[]}")
                .setHeader("Content-Type", "application/json"));

        VerificationReport report = client.verifyAudit(new VerifyAuditParams());
        assertTrue(report.isVerified());
    }

    @Test
    void testAuthorizationHeader() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"events\":[],\"total\":0,\"hasMore\":false}")
                .setHeader("Content-Type", "application/json"));

        client.queryEvents(new EventQuery());
        RecordedRequest req = server.takeRequest();
        assertEquals("Bearer test-key", req.getHeader("Authorization"));
    }

    // ─── Error Tests ───────────────────────────────────────────

    @Test
    void testAuthenticationError() {
        server.enqueue(new MockResponse().setResponseCode(401).setBody("{\"error\":\"Unauthorized\"}"));
        assertThrows(AuthenticationException.class, () -> client.queryEvents(new EventQuery()));
    }

    @Test
    void testNotFoundError() {
        server.enqueue(new MockResponse().setResponseCode(404).setBody("{\"error\":\"Not found\"}"));
        assertThrows(NotFoundException.class, () -> client.getEvent("nonexistent"));
    }

    @Test
    void testValidationError() {
        server.enqueue(new MockResponse().setResponseCode(400).setBody("{\"error\":\"Bad request\"}"));
        assertThrows(ValidationException.class, () -> client.queryEvents(new EventQuery()));
    }

    @Test
    void testQuotaExceededError() {
        server.enqueue(new MockResponse().setResponseCode(402).setBody("{\"error\":\"Quota exceeded\"}"));
        assertThrows(QuotaExceededException.class, () -> client.queryEvents(new EventQuery()));
    }

    @Test
    void testRateLimitError() {
        server.enqueue(new MockResponse().setResponseCode(429)
                .setBody("{\"error\":\"Rate limited\"}")
                .setHeader("Retry-After", "2"));
        assertThrows(RateLimitException.class, () -> client.queryEvents(new EventQuery()));
    }

    @Test
    void testBackpressureError() {
        server.enqueue(new MockResponse().setResponseCode(503).setBody("{\"error\":\"Overloaded\"}"));
        assertThrows(BackpressureException.class, () -> client.queryEvents(new EventQuery()));
    }

    @Test
    void testFailOpenMode() throws Exception {
        MockWebServer failServer = new MockWebServer();
        failServer.start();
        failServer.enqueue(new MockResponse().setResponseCode(500).setBody("{\"error\":\"Internal error\"}"));

        AgentLensClient failClient = AgentLensClient.builder()
                .url(failServer.url("/").toString())
                .apiKey("key")
                .retry(RetryConfig.noRetry())
                .failOpen(e -> {})
                .build();

        EventQueryResult result = failClient.queryEvents(new EventQuery());
        assertNull(result);

        failClient.close();
        failServer.shutdown();
    }

    @Test
    void testFromEnv() {
        // Just verify it doesn't throw (env vars won't be set in test)
        AgentLensClient envClient = AgentLensClient.fromEnv();
        assertNotNull(envClient);
        envClient.close();
    }

    @Test
    void testAsyncQueryEvents() throws Exception {
        server.enqueue(new MockResponse()
                .setBody("{\"events\":[],\"total\":0,\"hasMore\":false}")
                .setHeader("Content-Type", "application/json"));

        EventQueryResult result = client.queryEventsAsync(new EventQuery()).get();
        assertEquals(0, result.getTotal());
    }
}
