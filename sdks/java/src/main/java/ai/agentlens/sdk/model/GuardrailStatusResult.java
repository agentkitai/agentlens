package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.Map;

/** Status of a guardrail rule with recent triggers. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class GuardrailStatusResult {
    private GuardrailRule rule;
    private Map<String, Object> state;
    private List<GuardrailTriggerHistory> recentTriggers;

    public GuardrailStatusResult() {}

    public GuardrailRule getRule() { return rule; }
    public void setRule(GuardrailRule rule) { this.rule = rule; }
    public Map<String, Object> getState() { return state; }
    public void setState(Map<String, Object> state) { this.state = state; }
    public List<GuardrailTriggerHistory> getRecentTriggers() { return recentTriggers; }
    public void setRecentTriggers(List<GuardrailTriggerHistory> recentTriggers) { this.recentTriggers = recentTriggers; }
}
