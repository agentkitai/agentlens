package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.time.Instant;
import java.util.Map;

/** A guardrail rule definition. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class GuardrailRule {
    private String id;
    private String name;
    private String description;
    private String conditionType;
    private Map<String, Object> conditionConfig;
    private String actionType;
    private Map<String, Object> actionConfig;
    private String agentId;
    private boolean enabled;
    private Boolean dryRun;
    private Integer cooldownMinutes;
    private Instant createdAt;
    private Instant updatedAt;

    public GuardrailRule() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getConditionType() { return conditionType; }
    public void setConditionType(String conditionType) { this.conditionType = conditionType; }
    public Map<String, Object> getConditionConfig() { return conditionConfig; }
    public void setConditionConfig(Map<String, Object> conditionConfig) { this.conditionConfig = conditionConfig; }
    public String getActionType() { return actionType; }
    public void setActionType(String actionType) { this.actionType = actionType; }
    public Map<String, Object> getActionConfig() { return actionConfig; }
    public void setActionConfig(Map<String, Object> actionConfig) { this.actionConfig = actionConfig; }
    public String getAgentId() { return agentId; }
    public void setAgentId(String agentId) { this.agentId = agentId; }
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public Boolean getDryRun() { return dryRun; }
    public void setDryRun(Boolean dryRun) { this.dryRun = dryRun; }
    public Integer getCooldownMinutes() { return cooldownMinutes; }
    public void setCooldownMinutes(Integer cooldownMinutes) { this.cooldownMinutes = cooldownMinutes; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
