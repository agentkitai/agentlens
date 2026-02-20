package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.Map;

/** Result of a cross-session context query. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class ContextResult {
    private List<Map<String, Object>> context;
    private Map<String, Object> summary;

    public ContextResult() {}

    public List<Map<String, Object>> getContext() { return context; }
    public void setContext(List<Map<String, Object>> context) { this.context = context; }
    public Map<String, Object> getSummary() { return summary; }
    public void setSummary(Map<String, Object> summary) { this.summary = summary; }
}
