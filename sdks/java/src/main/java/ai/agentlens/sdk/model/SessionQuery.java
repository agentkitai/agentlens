package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Query parameters for session search. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class SessionQuery {
    private String agentId;
    private String status;
    private String from;
    private String to;
    private Integer limit;
    private Integer offset;

    public SessionQuery() {}

    public String getAgentId() { return agentId; }
    public SessionQuery setAgentId(String v) { this.agentId = v; return this; }
    public String getStatus() { return status; }
    public SessionQuery setStatus(String v) { this.status = v; return this; }
    public String getFrom() { return from; }
    public SessionQuery setFrom(String v) { this.from = v; return this; }
    public String getTo() { return to; }
    public SessionQuery setTo(String v) { this.to = v; return this; }
    public Integer getLimit() { return limit; }
    public SessionQuery setLimit(Integer v) { this.limit = v; return this; }
    public Integer getOffset() { return offset; }
    public SessionQuery setOffset(Integer v) { this.offset = v; return this; }

    public String toQueryString() {
        StringBuilder sb = new StringBuilder();
        appendParam(sb, "agentId", agentId);
        appendParam(sb, "status", status);
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
