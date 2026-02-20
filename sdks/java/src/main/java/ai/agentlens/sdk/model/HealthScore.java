package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.time.Instant;

/** Health score for an agent. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class HealthScore {
    private String agentId;
    private double score;
    private String status;
    private Double errorRate;
    private Double avgLatencyMs;
    private Integer totalCalls;
    private Instant calculatedAt;

    public HealthScore() {}

    public String getAgentId() { return agentId; }
    public void setAgentId(String agentId) { this.agentId = agentId; }
    public double getScore() { return score; }
    public void setScore(double score) { this.score = score; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Double getErrorRate() { return errorRate; }
    public void setErrorRate(Double errorRate) { this.errorRate = errorRate; }
    public Double getAvgLatencyMs() { return avgLatencyMs; }
    public void setAvgLatencyMs(Double avgLatencyMs) { this.avgLatencyMs = avgLatencyMs; }
    public Integer getTotalCalls() { return totalCalls; }
    public void setTotalCalls(Integer totalCalls) { this.totalCalls = totalCalls; }
    public Instant getCalculatedAt() { return calculatedAt; }
    public void setCalculatedAt(Instant calculatedAt) { this.calculatedAt = calculatedAt; }
}
