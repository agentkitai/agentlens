package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.Map;

/** Result of a reflect (pattern analysis) query. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class ReflectResult {
    private List<Map<String, Object>> patterns;
    private Map<String, Object> summary;

    public ReflectResult() {}

    public List<Map<String, Object>> getPatterns() { return patterns; }
    public void setPatterns(List<Map<String, Object>> patterns) { this.patterns = patterns; }
    public Map<String, Object> getSummary() { return summary; }
    public void setSummary(Map<String, Object> summary) { this.summary = summary; }
}
