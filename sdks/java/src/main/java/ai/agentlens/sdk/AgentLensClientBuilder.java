package ai.agentlens.sdk;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.function.Consumer;

/**
 * Builder for {@link AgentLensClient}.
 *
 * <pre>{@code
 * AgentLensClient client = AgentLensClient.builder()
 *     .url("http://localhost:3400")
 *     .apiKey("my-api-key")
 *     .timeout(Duration.ofSeconds(30))
 *     .build();
 * }</pre>
 */
public class AgentLensClientBuilder {
    String url = "http://localhost:3400";
    String apiKey;
    Duration timeout = Duration.ofSeconds(30);
    RetryConfig retry = RetryConfig.defaults();
    boolean failOpen = false;
    Consumer<Exception> onError;
    HttpClient httpClient;
    ObjectMapper objectMapper;

    AgentLensClientBuilder() {}

    /** Set the AgentLens server URL. */
    public AgentLensClientBuilder url(String url) {
        this.url = url;
        return this;
    }

    /** Set the API key for authentication. */
    public AgentLensClientBuilder apiKey(String apiKey) {
        this.apiKey = apiKey;
        return this;
    }

    /** Set the request timeout. */
    public AgentLensClientBuilder timeout(Duration timeout) {
        this.timeout = timeout;
        return this;
    }

    /** Set the retry configuration. */
    public AgentLensClientBuilder retry(RetryConfig retry) {
        this.retry = retry;
        return this;
    }

    /** Enable fail-open mode: errors are swallowed and passed to the given consumer. */
    public AgentLensClientBuilder failOpen(Consumer<Exception> onError) {
        this.failOpen = true;
        this.onError = onError;
        return this;
    }

    /** Override the default HttpClient. */
    public AgentLensClientBuilder httpClient(HttpClient httpClient) {
        this.httpClient = httpClient;
        return this;
    }

    /** Override the default Jackson ObjectMapper. */
    public AgentLensClientBuilder objectMapper(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        return this;
    }

    /** Build the client. */
    public AgentLensClient build() {
        return new AgentLensClient(this);
    }
}
