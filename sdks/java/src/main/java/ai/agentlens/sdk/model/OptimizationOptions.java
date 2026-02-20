package ai.agentlens.sdk.model;

/** Options for optimization recommendations query. */
public class OptimizationOptions {
    private String agentId;
    private Integer period;
    private Integer limit;

    public OptimizationOptions() {}

    public String getAgentId() { return agentId; }
    public OptimizationOptions setAgentId(String v) { this.agentId = v; return this; }
    public Integer getPeriod() { return period; }
    public OptimizationOptions setPeriod(Integer v) { this.period = v; return this; }
    public Integer getLimit() { return limit; }
    public OptimizationOptions setLimit(Integer v) { this.limit = v; return this; }

    public String toQueryString() {
        StringBuilder sb = new StringBuilder();
        if (agentId != null) appendParam(sb, "agentId", agentId);
        if (period != null) appendParam(sb, "period", String.valueOf(period));
        if (limit != null) appendParam(sb, "limit", String.valueOf(limit));
        return sb.toString();
    }

    private static void appendParam(StringBuilder sb, String key, String value) {
        if (sb.length() > 0) sb.append('&');
        sb.append(key).append('=').append(value);
    }
}
