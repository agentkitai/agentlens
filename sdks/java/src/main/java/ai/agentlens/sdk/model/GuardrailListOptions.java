package ai.agentlens.sdk.model;

/** Options for listing guardrail rules. */
public class GuardrailListOptions {
    private String agentId;

    public GuardrailListOptions() {}

    public String getAgentId() { return agentId; }
    public GuardrailListOptions setAgentId(String v) { this.agentId = v; return this; }

    public String toQueryString() {
        if (agentId != null && !agentId.isEmpty()) return "agentId=" + agentId;
        return "";
    }
}
