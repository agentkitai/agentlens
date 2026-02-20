package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/** Timeline of events for a session. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class TimelineResult {
    private List<Event> events;
    private boolean chainValid;

    public TimelineResult() {}

    public List<Event> getEvents() { return events; }
    public void setEvents(List<Event> events) { this.events = events; }
    public boolean isChainValid() { return chainValid; }
    public void setChainValid(boolean chainValid) { this.chainValid = chainValid; }
}
