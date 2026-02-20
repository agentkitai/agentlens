package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.Map;

/** Cost optimization recommendations. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class OptimizationResult {
    private List<Recommendation> recommendations;
    private Map<String, Object> summary;

    public OptimizationResult() {}

    public List<Recommendation> getRecommendations() { return recommendations; }
    public void setRecommendations(List<Recommendation> recommendations) { this.recommendations = recommendations; }
    public Map<String, Object> getSummary() { return summary; }
    public void setSummary(Map<String, Object> summary) { this.summary = summary; }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Recommendation {
        private String type;
        private String description;
        private Double estimatedSavings;
        private String agentId;
        private Map<String, Object> details;

        public Recommendation() {}
        public String getType() { return type; }
        public void setType(String type) { this.type = type; }
        public String getDescription() { return description; }
        public void setDescription(String description) { this.description = description; }
        public Double getEstimatedSavings() { return estimatedSavings; }
        public void setEstimatedSavings(Double estimatedSavings) { this.estimatedSavings = estimatedSavings; }
        public String getAgentId() { return agentId; }
        public void setAgentId(String agentId) { this.agentId = agentId; }
        public Map<String, Object> getDetails() { return details; }
        public void setDetails(Map<String, Object> details) { this.details = details; }
    }
}
