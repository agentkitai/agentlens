package ai.agentlens.sdk;

import ai.agentlens.sdk.exception.*;
import ai.agentlens.sdk.model.*;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.*;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.*;

class RetryTest {

    private MockWebServer server;

    @BeforeEach
    void setUp() throws Exception {
        server = new MockWebServer();
        server.start();
    }

    @AfterEach
    void tearDown() throws Exception {
        server.shutdown();
    }

    @Test
    void testRetryOn429ThenSuccess() {
        server.enqueue(new MockResponse().setResponseCode(429).setBody("{\"error\":\"rate limited\"}"));
        server.enqueue(new MockResponse()
                .setBody("{\"events\":[],\"total\":0,\"hasMore\":false}")
                .setHeader("Content-Type", "application/json"));

        AgentLensClient client = AgentLensClient.builder()
                .url(server.url("/").toString())
                .apiKey("key")
                .retry(new RetryConfig(3, Duration.ofMillis(10), Duration.ofMillis(100)))
                .build();

        EventQueryResult result = client.queryEvents(new EventQuery());
        assertEquals(0, result.getTotal());
        assertEquals(2, server.getRequestCount());
        client.close();
    }

    @Test
    void testRetryOn503ThenSuccess() {
        server.enqueue(new MockResponse().setResponseCode(503).setBody("{\"error\":\"overloaded\"}"));
        server.enqueue(new MockResponse()
                .setBody("{\"events\":[],\"total\":0,\"hasMore\":false}")
                .setHeader("Content-Type", "application/json"));

        AgentLensClient client = AgentLensClient.builder()
                .url(server.url("/").toString())
                .apiKey("key")
                .retry(new RetryConfig(3, Duration.ofMillis(10), Duration.ofMillis(100)))
                .build();

        EventQueryResult result = client.queryEvents(new EventQuery());
        assertEquals(0, result.getTotal());
        assertEquals(2, server.getRequestCount());
        client.close();
    }

    @Test
    void testNoRetryOn401() {
        server.enqueue(new MockResponse().setResponseCode(401).setBody("{\"error\":\"unauthorized\"}"));

        AgentLensClient client = AgentLensClient.builder()
                .url(server.url("/").toString())
                .apiKey("key")
                .retry(new RetryConfig(3, Duration.ofMillis(10), Duration.ofMillis(100)))
                .build();

        assertThrows(AuthenticationException.class, () -> client.queryEvents(new EventQuery()));
        assertEquals(1, server.getRequestCount());
        client.close();
    }

    @Test
    void testNoRetryOn400() {
        server.enqueue(new MockResponse().setResponseCode(400).setBody("{\"error\":\"bad request\"}"));

        AgentLensClient client = AgentLensClient.builder()
                .url(server.url("/").toString())
                .apiKey("key")
                .retry(new RetryConfig(3, Duration.ofMillis(10), Duration.ofMillis(100)))
                .build();

        assertThrows(ValidationException.class, () -> client.queryEvents(new EventQuery()));
        assertEquals(1, server.getRequestCount());
        client.close();
    }

    @Test
    void testNoRetryOn404() {
        server.enqueue(new MockResponse().setResponseCode(404).setBody("{\"error\":\"not found\"}"));

        AgentLensClient client = AgentLensClient.builder()
                .url(server.url("/").toString())
                .apiKey("key")
                .retry(new RetryConfig(3, Duration.ofMillis(10), Duration.ofMillis(100)))
                .build();

        assertThrows(NotFoundException.class, () -> client.getEvent("x"));
        assertEquals(1, server.getRequestCount());
        client.close();
    }

    @Test
    void testRetryExhausted() {
        // All attempts return 429
        for (int i = 0; i < 4; i++) {
            server.enqueue(new MockResponse().setResponseCode(429).setBody("{\"error\":\"rate limited\"}"));
        }

        AgentLensClient client = AgentLensClient.builder()
                .url(server.url("/").toString())
                .apiKey("key")
                .retry(new RetryConfig(3, Duration.ofMillis(10), Duration.ofMillis(100)))
                .build();

        assertThrows(RateLimitException.class, () -> client.queryEvents(new EventQuery()));
        assertEquals(4, server.getRequestCount()); // 1 initial + 3 retries
        client.close();
    }

    @Test
    void testRetryAfterHeader() {
        server.enqueue(new MockResponse()
                .setResponseCode(429)
                .setBody("{\"error\":\"rate limited\"}")
                .setHeader("Retry-After", "0.01"));
        server.enqueue(new MockResponse()
                .setBody("{\"events\":[],\"total\":0,\"hasMore\":false}")
                .setHeader("Content-Type", "application/json"));

        AgentLensClient client = AgentLensClient.builder()
                .url(server.url("/").toString())
                .apiKey("key")
                .retry(new RetryConfig(3, Duration.ofMillis(10), Duration.ofMillis(100)))
                .build();

        EventQueryResult result = client.queryEvents(new EventQuery());
        assertEquals(0, result.getTotal());
        client.close();
    }
}
