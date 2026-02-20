package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.time.Instant;

/** An AgentLens session. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class Session {
    private String id;
    private String agentId;
    private String status;
    private Instant startedAt;
    private Instant endedAt;
    private Integer eventCount;

    public Session() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getAgentId() { return agentId; }
    public void setAgentId(String agentId) { this.agentId = agentId; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Instant getStartedAt() { return startedAt; }
    public void setStartedAt(Instant startedAt) { this.startedAt = startedAt; }
    public Instant getEndedAt() { return endedAt; }
    public void setEndedAt(Instant endedAt) { this.endedAt = endedAt; }
    public Integer getEventCount() { return eventCount; }
    public void setEventCount(Integer eventCount) { this.eventCount = eventCount; }
}
