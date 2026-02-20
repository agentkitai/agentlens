package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.Map;

/** Parameters for creating a guardrail rule. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class CreateGuardrailParams {
    private String name;
    private String description;
    private String conditionType;
    private Map<String, Object> conditionConfig;
    private String actionType;
    private Map<String, Object> actionConfig;
    private String agentId;
    private Boolean enabled;
    private Boolean dryRun;
    private Integer cooldownMinutes;

    public CreateGuardrailParams() {}

    public String getName() { return name; }
    public CreateGuardrailParams setName(String v) { this.name = v; return this; }
    public String getDescription() { return description; }
    public CreateGuardrailParams setDescription(String v) { this.description = v; return this; }
    public String getConditionType() { return conditionType; }
    public CreateGuardrailParams setConditionType(String v) { this.conditionType = v; return this; }
    public Map<String, Object> getConditionConfig() { return conditionConfig; }
    public CreateGuardrailParams setConditionConfig(Map<String, Object> v) { this.conditionConfig = v; return this; }
    public String getActionType() { return actionType; }
    public CreateGuardrailParams setActionType(String v) { this.actionType = v; return this; }
    public Map<String, Object> getActionConfig() { return actionConfig; }
    public CreateGuardrailParams setActionConfig(Map<String, Object> v) { this.actionConfig = v; return this; }
    public String getAgentId() { return agentId; }
    public CreateGuardrailParams setAgentId(String v) { this.agentId = v; return this; }
    public Boolean getEnabled() { return enabled; }
    public CreateGuardrailParams setEnabled(Boolean v) { this.enabled = v; return this; }
    public Boolean getDryRun() { return dryRun; }
    public CreateGuardrailParams setDryRun(Boolean v) { this.dryRun = v; return this; }
    public Integer getCooldownMinutes() { return cooldownMinutes; }
    public CreateGuardrailParams setCooldownMinutes(Integer v) { this.cooldownMinutes = v; return this; }
}
