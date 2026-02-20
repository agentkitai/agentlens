package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/** LLM analytics result with summary, by-model, and by-time breakdowns. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class LlmAnalyticsResult {
    private Summary summary;
    private List<ByModel> byModel;
    private List<ByTime> byTime;

    public LlmAnalyticsResult() {}

    public Summary getSummary() { return summary; }
    public void setSummary(Summary summary) { this.summary = summary; }
    public List<ByModel> getByModel() { return byModel; }
    public void setByModel(List<ByModel> byModel) { this.byModel = byModel; }
    public List<ByTime> getByTime() { return byTime; }
    public void setByTime(List<ByTime> byTime) { this.byTime = byTime; }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Summary {
        private int totalCalls;
        private double totalCostUsd;
        private long totalInputTokens;
        private long totalOutputTokens;
        private double avgLatencyMs;
        private double avgCostPerCall;

        public Summary() {}
        public int getTotalCalls() { return totalCalls; }
        public void setTotalCalls(int v) { this.totalCalls = v; }
        public double getTotalCostUsd() { return totalCostUsd; }
        public void setTotalCostUsd(double v) { this.totalCostUsd = v; }
        public long getTotalInputTokens() { return totalInputTokens; }
        public void setTotalInputTokens(long v) { this.totalInputTokens = v; }
        public long getTotalOutputTokens() { return totalOutputTokens; }
        public void setTotalOutputTokens(long v) { this.totalOutputTokens = v; }
        public double getAvgLatencyMs() { return avgLatencyMs; }
        public void setAvgLatencyMs(double v) { this.avgLatencyMs = v; }
        public double getAvgCostPerCall() { return avgCostPerCall; }
        public void setAvgCostPerCall(double v) { this.avgCostPerCall = v; }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class ByModel {
        private String provider;
        private String model;
        private int calls;
        private double costUsd;
        private long inputTokens;
        private long outputTokens;
        private double avgLatencyMs;

        public ByModel() {}
        public String getProvider() { return provider; }
        public void setProvider(String v) { this.provider = v; }
        public String getModel() { return model; }
        public void setModel(String v) { this.model = v; }
        public int getCalls() { return calls; }
        public void setCalls(int v) { this.calls = v; }
        public double getCostUsd() { return costUsd; }
        public void setCostUsd(double v) { this.costUsd = v; }
        public long getInputTokens() { return inputTokens; }
        public void setInputTokens(long v) { this.inputTokens = v; }
        public long getOutputTokens() { return outputTokens; }
        public void setOutputTokens(long v) { this.outputTokens = v; }
        public double getAvgLatencyMs() { return avgLatencyMs; }
        public void setAvgLatencyMs(double v) { this.avgLatencyMs = v; }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class ByTime {
        private String bucket;
        private int calls;
        private double costUsd;
        private long inputTokens;
        private long outputTokens;
        private double avgLatencyMs;

        public ByTime() {}
        public String getBucket() { return bucket; }
        public void setBucket(String v) { this.bucket = v; }
        public int getCalls() { return calls; }
        public void setCalls(int v) { this.calls = v; }
        public double getCostUsd() { return costUsd; }
        public void setCostUsd(double v) { this.costUsd = v; }
        public long getInputTokens() { return inputTokens; }
        public void setInputTokens(long v) { this.inputTokens = v; }
        public long getOutputTokens() { return outputTokens; }
        public void setOutputTokens(long v) { this.outputTokens = v; }
        public double getAvgLatencyMs() { return avgLatencyMs; }
        public void setAvgLatencyMs(double v) { this.avgLatencyMs = v; }
    }
}
