package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.Map;

/** Query parameters for pattern analysis (reflect). */
@JsonIgnoreProperties(ignoreUnknown = true)
public class ReflectQuery {
    private String analysis;
    private String agentId;
    private String from;
    private String to;
    private Integer limit;
    private Map<String, Object> params;

    public ReflectQuery() {}

    public String getAnalysis() { return analysis; }
    public ReflectQuery setAnalysis(String v) { this.analysis = v; return this; }
    public String getAgentId() { return agentId; }
    public ReflectQuery setAgentId(String v) { this.agentId = v; return this; }
    public String getFrom() { return from; }
    public ReflectQuery setFrom(String v) { this.from = v; return this; }
    public String getTo() { return to; }
    public ReflectQuery setTo(String v) { this.to = v; return this; }
    public Integer getLimit() { return limit; }
    public ReflectQuery setLimit(Integer v) { this.limit = v; return this; }
    public Map<String, Object> getParams() { return params; }
    public ReflectQuery setParams(Map<String, Object> v) { this.params = v; return this; }

    public String toQueryString() {
        StringBuilder sb = new StringBuilder();
        appendParam(sb, "analysis", analysis);
        appendParam(sb, "agentId", agentId);
        appendParam(sb, "from", from);
        appendParam(sb, "to", to);
        if (limit != null) appendParam(sb, "limit", String.valueOf(limit));
        if (params != null) {
            try {
                appendParam(sb, "params", new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(params));
            } catch (Exception e) { /* ignore */ }
        }
        return sb.toString();
    }

    private static void appendParam(StringBuilder sb, String key, String value) {
        if (value == null || value.isEmpty()) return;
        if (sb.length() > 0) sb.append('&');
        sb.append(key).append('=').append(value);
    }
}
