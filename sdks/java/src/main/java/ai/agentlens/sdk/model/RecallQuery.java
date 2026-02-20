package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Query parameters for semantic recall search. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class RecallQuery {
    private String query;
    private String scope;
    private String agentId;
    private String from;
    private String to;
    private Integer limit;
    private Double minScore;

    public RecallQuery() {}

    public String getQuery() { return query; }
    public RecallQuery setQuery(String v) { this.query = v; return this; }
    public String getScope() { return scope; }
    public RecallQuery setScope(String v) { this.scope = v; return this; }
    public String getAgentId() { return agentId; }
    public RecallQuery setAgentId(String v) { this.agentId = v; return this; }
    public String getFrom() { return from; }
    public RecallQuery setFrom(String v) { this.from = v; return this; }
    public String getTo() { return to; }
    public RecallQuery setTo(String v) { this.to = v; return this; }
    public Integer getLimit() { return limit; }
    public RecallQuery setLimit(Integer v) { this.limit = v; return this; }
    public Double getMinScore() { return minScore; }
    public RecallQuery setMinScore(Double v) { this.minScore = v; return this; }

    public String toQueryString() {
        StringBuilder sb = new StringBuilder();
        appendParam(sb, "query", query);
        appendParam(sb, "scope", scope);
        appendParam(sb, "agentId", agentId);
        appendParam(sb, "from", from);
        appendParam(sb, "to", to);
        if (limit != null) appendParam(sb, "limit", String.valueOf(limit));
        if (minScore != null) appendParam(sb, "minScore", String.valueOf(minScore));
        return sb.toString();
    }

    private static void appendParam(StringBuilder sb, String key, String value) {
        if (value == null || value.isEmpty()) return;
        if (sb.length() > 0) sb.append('&');
        sb.append(key).append('=').append(value);
    }
}
