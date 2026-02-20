package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/** Result of an event query. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class EventQueryResult {
    private List<Event> events;
    private int total;
    private boolean hasMore;

    public EventQueryResult() {}

    public List<Event> getEvents() { return events; }
    public void setEvents(List<Event> events) { this.events = events; }
    public int getTotal() { return total; }
    public void setTotal(int total) { this.total = total; }
    public boolean isHasMore() { return hasMore; }
    public void setHasMore(boolean hasMore) { this.hasMore = hasMore; }
}
