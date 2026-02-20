package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Query parameters for cross-session context. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class ContextQuery {
    private String topic;
    private String userId;
    private String agentId;
    private String from;
    private String to;
    private Integer limit;

    public ContextQuery() {}

    public String getTopic() { return topic; }
    public ContextQuery setTopic(String v) { this.topic = v; return this; }
    public String getUserId() { return userId; }
    public ContextQuery setUserId(String v) { this.userId = v; return this; }
    public String getAgentId() { return agentId; }
    public ContextQuery setAgentId(String v) { this.agentId = v; return this; }
    public String getFrom() { return from; }
    public ContextQuery setFrom(String v) { this.from = v; return this; }
    public String getTo() { return to; }
    public ContextQuery setTo(String v) { this.to = v; return this; }
    public Integer getLimit() { return limit; }
    public ContextQuery setLimit(Integer v) { this.limit = v; return this; }

    public String toQueryString() {
        StringBuilder sb = new StringBuilder();
        appendParam(sb, "topic", topic);
        appendParam(sb, "userId", userId);
        appendParam(sb, "agentId", agentId);
        appendParam(sb, "from", from);
        appendParam(sb, "to", to);
        if (limit != null) appendParam(sb, "limit", String.valueOf(limit));
        return sb.toString();
    }

    private static void appendParam(StringBuilder sb, String key, String value) {
        if (value == null || value.isEmpty()) return;
        if (sb.length() > 0) sb.append('&');
        sb.append(key).append('=').append(value);
    }
}
