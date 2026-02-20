package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.time.Instant;
import java.util.Map;

/** An AgentLens agent. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class Agent {
    private String id;
    private String name;
    private String description;
    private String status;
    private String modelOverride;
    private Instant pausedAt;
    private Map<String, Object> config;

    public Agent() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getModelOverride() { return modelOverride; }
    public void setModelOverride(String modelOverride) { this.modelOverride = modelOverride; }
    public Instant getPausedAt() { return pausedAt; }
    public void setPausedAt(Instant pausedAt) { this.pausedAt = pausedAt; }
    public Map<String, Object> getConfig() { return config; }
    public void setConfig(Map<String, Object> config) { this.config = config; }
}
