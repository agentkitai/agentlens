package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.time.Instant;

/** Historical health snapshot. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class HealthSnapshot {
    private String agentId;
    private double score;
    private Instant timestamp;
    private Integer totalCalls;
    private Double errorRate;
    private Double avgLatencyMs;

    public HealthSnapshot() {}

    public String getAgentId() { return agentId; }
    public void setAgentId(String agentId) { this.agentId = agentId; }
    public double getScore() { return score; }
    public void setScore(double score) { this.score = score; }
    public Instant getTimestamp() { return timestamp; }
    public void setTimestamp(Instant timestamp) { this.timestamp = timestamp; }
    public Integer getTotalCalls() { return totalCalls; }
    public void setTotalCalls(Integer totalCalls) { this.totalCalls = totalCalls; }
    public Double getErrorRate() { return errorRate; }
    public void setErrorRate(Double errorRate) { this.errorRate = errorRate; }
    public Double getAvgLatencyMs() { return avgLatencyMs; }
    public void setAvgLatencyMs(Double avgLatencyMs) { this.avgLatencyMs = avgLatencyMs; }
}
