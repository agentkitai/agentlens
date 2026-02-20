package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/** Result containing guardrail trigger history. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class GuardrailTriggerHistoryResult {
    private List<GuardrailTriggerHistory> triggers;
    private int total;

    public GuardrailTriggerHistoryResult() {}

    public List<GuardrailTriggerHistory> getTriggers() { return triggers; }
    public void setTriggers(List<GuardrailTriggerHistory> triggers) { this.triggers = triggers; }
    public int getTotal() { return total; }
    public void setTotal(int total) { this.total = total; }
}
