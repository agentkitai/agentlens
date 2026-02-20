package ai.agentlens.sdk.model;

/** Options for querying guardrail trigger history. */
public class GuardrailHistoryOptions {
    private String ruleId;
    private Integer limit;
    private Integer offset;

    public GuardrailHistoryOptions() {}

    public String getRuleId() { return ruleId; }
    public GuardrailHistoryOptions setRuleId(String v) { this.ruleId = v; return this; }
    public Integer getLimit() { return limit; }
    public GuardrailHistoryOptions setLimit(Integer v) { this.limit = v; return this; }
    public Integer getOffset() { return offset; }
    public GuardrailHistoryOptions setOffset(Integer v) { this.offset = v; return this; }

    public String toQueryString() {
        StringBuilder sb = new StringBuilder();
        if (ruleId != null) appendParam(sb, "ruleId", ruleId);
        if (limit != null) appendParam(sb, "limit", String.valueOf(limit));
        if (offset != null) appendParam(sb, "offset", String.valueOf(offset));
        return sb.toString();
    }

    private static void appendParam(StringBuilder sb, String key, String value) {
        if (sb.length() > 0) sb.append('&');
        sb.append(key).append('=').append(value);
    }
}
