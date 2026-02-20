package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.Map;

/** Parameters for updating a guardrail rule. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class UpdateGuardrailParams {
    private String name;
    private String description;
    private String conditionType;
    private Map<String, Object> conditionConfig;
    private String actionType;
    private Map<String, Object> actionConfig;
    private Boolean enabled;
    private Boolean dryRun;
    private Integer cooldownMinutes;

    public UpdateGuardrailParams() {}

    public String getName() { return name; }
    public UpdateGuardrailParams setName(String v) { this.name = v; return this; }
    public String getDescription() { return description; }
    public UpdateGuardrailParams setDescription(String v) { this.description = v; return this; }
    public String getConditionType() { return conditionType; }
    public UpdateGuardrailParams setConditionType(String v) { this.conditionType = v; return this; }
    public Map<String, Object> getConditionConfig() { return conditionConfig; }
    public UpdateGuardrailParams setConditionConfig(Map<String, Object> v) { this.conditionConfig = v; return this; }
    public String getActionType() { return actionType; }
    public UpdateGuardrailParams setActionType(String v) { this.actionType = v; return this; }
    public Map<String, Object> getActionConfig() { return actionConfig; }
    public UpdateGuardrailParams setActionConfig(Map<String, Object> v) { this.actionConfig = v; return this; }
    public Boolean getEnabled() { return enabled; }
    public UpdateGuardrailParams setEnabled(Boolean v) { this.enabled = v; return this; }
    public Boolean getDryRun() { return dryRun; }
    public UpdateGuardrailParams setDryRun(Boolean v) { this.dryRun = v; return this; }
    public Integer getCooldownMinutes() { return cooldownMinutes; }
    public UpdateGuardrailParams setCooldownMinutes(Integer v) { this.cooldownMinutes = v; return this; }
}
