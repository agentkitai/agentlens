package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/** Result containing a list of guardrail rules. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class GuardrailRuleListResult {
    private List<GuardrailRule> rules;

    public GuardrailRuleListResult() {}

    public List<GuardrailRule> getRules() { return rules; }
    public void setRules(List<GuardrailRule> rules) { this.rules = rules; }
}
