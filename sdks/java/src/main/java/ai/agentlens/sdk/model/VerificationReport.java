package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.Map;

/** Audit trail verification report. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class VerificationReport {
    private boolean verified;
    private String verifiedAt;
    private Map<String, String> range;
    private String sessionId;
    private int sessionsVerified;
    private int totalEvents;
    private String firstHash;
    private String lastHash;
    private List<BrokenChainDetail> brokenChains;
    private String signature;

    public VerificationReport() {}

    public boolean isVerified() { return verified; }
    public void setVerified(boolean verified) { this.verified = verified; }
    public String getVerifiedAt() { return verifiedAt; }
    public void setVerifiedAt(String verifiedAt) { this.verifiedAt = verifiedAt; }
    public Map<String, String> getRange() { return range; }
    public void setRange(Map<String, String> range) { this.range = range; }
    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }
    public int getSessionsVerified() { return sessionsVerified; }
    public void setSessionsVerified(int sessionsVerified) { this.sessionsVerified = sessionsVerified; }
    public int getTotalEvents() { return totalEvents; }
    public void setTotalEvents(int totalEvents) { this.totalEvents = totalEvents; }
    public String getFirstHash() { return firstHash; }
    public void setFirstHash(String firstHash) { this.firstHash = firstHash; }
    public String getLastHash() { return lastHash; }
    public void setLastHash(String lastHash) { this.lastHash = lastHash; }
    public List<BrokenChainDetail> getBrokenChains() { return brokenChains; }
    public void setBrokenChains(List<BrokenChainDetail> brokenChains) { this.brokenChains = brokenChains; }
    public String getSignature() { return signature; }
    public void setSignature(String signature) { this.signature = signature; }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class BrokenChainDetail {
        private String sessionId;
        private int failedAtIndex;
        private String failedEventId;
        private String reason;

        public BrokenChainDetail() {}
        public String getSessionId() { return sessionId; }
        public void setSessionId(String sessionId) { this.sessionId = sessionId; }
        public int getFailedAtIndex() { return failedAtIndex; }
        public void setFailedAtIndex(int failedAtIndex) { this.failedAtIndex = failedAtIndex; }
        public String getFailedEventId() { return failedEventId; }
        public void setFailedEventId(String failedEventId) { this.failedEventId = failedEventId; }
        public String getReason() { return reason; }
        public void setReason(String reason) { this.reason = reason; }
    }
}
