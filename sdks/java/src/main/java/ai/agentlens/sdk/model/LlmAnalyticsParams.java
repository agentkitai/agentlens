package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Parameters for LLM analytics query. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class LlmAnalyticsParams {
    private String from;
    private String to;
    private String agentId;
    private String model;
    private String provider;
    private String granularity;

    public LlmAnalyticsParams() {}

    public String getFrom() { return from; }
    public LlmAnalyticsParams setFrom(String v) { this.from = v; return this; }
    public String getTo() { return to; }
    public LlmAnalyticsParams setTo(String v) { this.to = v; return this; }
    public String getAgentId() { return agentId; }
    public LlmAnalyticsParams setAgentId(String v) { this.agentId = v; return this; }
    public String getModel() { return model; }
    public LlmAnalyticsParams setModel(String v) { this.model = v; return this; }
    public String getProvider() { return provider; }
    public LlmAnalyticsParams setProvider(String v) { this.provider = v; return this; }
    public String getGranularity() { return granularity; }
    public LlmAnalyticsParams setGranularity(String v) { this.granularity = v; return this; }

    public String toQueryString() {
        StringBuilder sb = new StringBuilder();
        appendParam(sb, "from", from);
        appendParam(sb, "to", to);
        appendParam(sb, "agentId", agentId);
        appendParam(sb, "model", model);
        appendParam(sb, "provider", provider);
        appendParam(sb, "granularity", granularity);
        return sb.toString();
    }

    private static void appendParam(StringBuilder sb, String key, String value) {
        if (value == null || value.isEmpty()) return;
        if (sb.length() > 0) sb.append('&');
        sb.append(key).append('=').append(value);
    }
}
