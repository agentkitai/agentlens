package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.time.Instant;
import java.util.Map;

/** A guardrail trigger history entry. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class GuardrailTriggerHistory {
    private String id;
    private String ruleId;
    private String ruleName;
    private String agentId;
    private String sessionId;
    private String actionTaken;
    private Map<String, Object> triggerContext;
    private Instant triggeredAt;

    public GuardrailTriggerHistory() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getRuleId() { return ruleId; }
    public void setRuleId(String ruleId) { this.ruleId = ruleId; }
    public String getRuleName() { return ruleName; }
    public void setRuleName(String ruleName) { this.ruleName = ruleName; }
    public String getAgentId() { return agentId; }
    public void setAgentId(String agentId) { this.agentId = agentId; }
    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }
    public String getActionTaken() { return actionTaken; }
    public void setActionTaken(String actionTaken) { this.actionTaken = actionTaken; }
    public Map<String, Object> getTriggerContext() { return triggerContext; }
    public void setTriggerContext(Map<String, Object> triggerContext) { this.triggerContext = triggerContext; }
    public Instant getTriggeredAt() { return triggeredAt; }
    public void setTriggeredAt(Instant triggeredAt) { this.triggeredAt = triggeredAt; }
}
