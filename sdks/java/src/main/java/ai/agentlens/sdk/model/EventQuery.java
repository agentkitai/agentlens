package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Query parameters for event search. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class EventQuery {
    private String sessionId;
    private String agentId;
    private String eventType;
    private String from;
    private String to;
    private Integer limit;
    private Integer offset;

    public EventQuery() {}

    public String getSessionId() { return sessionId; }
    public EventQuery setSessionId(String v) { this.sessionId = v; return this; }
    public String getAgentId() { return agentId; }
    public EventQuery setAgentId(String v) { this.agentId = v; return this; }
    public String getEventType() { return eventType; }
    public EventQuery setEventType(String v) { this.eventType = v; return this; }
    public String getFrom() { return from; }
    public EventQuery setFrom(String v) { this.from = v; return this; }
    public String getTo() { return to; }
    public EventQuery setTo(String v) { this.to = v; return this; }
    public Integer getLimit() { return limit; }
    public EventQuery setLimit(Integer v) { this.limit = v; return this; }
    public Integer getOffset() { return offset; }
    public EventQuery setOffset(Integer v) { this.offset = v; return this; }

    /** Convert to query string for URL. */
    public String toQueryString() {
        StringBuilder sb = new StringBuilder();
        appendParam(sb, "sessionId", sessionId);
        appendParam(sb, "agentId", agentId);
        appendParam(sb, "eventType", eventType);
        appendParam(sb, "from", from);
        appendParam(sb, "to", to);
        if (limit != null) appendParam(sb, "limit", String.valueOf(limit));
        if (offset != null) appendParam(sb, "offset", String.valueOf(offset));
        return sb.toString();
    }

    private static void appendParam(StringBuilder sb, String key, String value) {
        if (value == null || value.isEmpty()) return;
        if (sb.length() > 0) sb.append('&');
        sb.append(key).append('=').append(value);
    }
}
