package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.Map;

/** Result of a recall (semantic search) query. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class RecallResult {
    private List<RecallMatch> matches;
    private int total;

    public RecallResult() {}

    public List<RecallMatch> getMatches() { return matches; }
    public void setMatches(List<RecallMatch> matches) { this.matches = matches; }
    public int getTotal() { return total; }
    public void setTotal(int total) { this.total = total; }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class RecallMatch {
        private String id;
        private double score;
        private String content;
        private Map<String, Object> metadata;

        public RecallMatch() {}
        public String getId() { return id; }
        public void setId(String id) { this.id = id; }
        public double getScore() { return score; }
        public void setScore(double score) { this.score = score; }
        public String getContent() { return content; }
        public void setContent(String content) { this.content = content; }
        public Map<String, Object> getMetadata() { return metadata; }
        public void setMetadata(Map<String, Object> metadata) { this.metadata = metadata; }
    }
}
