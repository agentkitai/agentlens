package ai.agentlens.sdk.model;

/** Parameters for audit verification. */
public class VerifyAuditParams {
    private String from;
    private String to;
    private String sessionId;

    public VerifyAuditParams() {}

    public String getFrom() { return from; }
    public VerifyAuditParams setFrom(String v) { this.from = v; return this; }
    public String getTo() { return to; }
    public VerifyAuditParams setTo(String v) { this.to = v; return this; }
    public String getSessionId() { return sessionId; }
    public VerifyAuditParams setSessionId(String v) { this.sessionId = v; return this; }

    public String toQueryString() {
        StringBuilder sb = new StringBuilder();
        if (from != null) appendParam(sb, "from", from);
        if (to != null) appendParam(sb, "to", to);
        if (sessionId != null) appendParam(sb, "sessionId", sessionId);
        return sb.toString();
    }

    private static void appendParam(StringBuilder sb, String key, String value) {
        if (sb.length() > 0) sb.append('&');
        sb.append(key).append('=').append(value);
    }
}
