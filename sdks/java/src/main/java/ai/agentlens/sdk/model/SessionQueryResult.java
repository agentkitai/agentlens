package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/** Result of a session query. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class SessionQueryResult {
    private List<Session> sessions;
    private int total;
    private boolean hasMore;

    public SessionQueryResult() {}

    public List<Session> getSessions() { return sessions; }
    public void setSessions(List<Session> sessions) { this.sessions = sessions; }
    public int getTotal() { return total; }
    public void setTotal(int total) { this.total = total; }
    public boolean isHasMore() { return hasMore; }
    public void setHasMore(boolean hasMore) { this.hasMore = hasMore; }
}
