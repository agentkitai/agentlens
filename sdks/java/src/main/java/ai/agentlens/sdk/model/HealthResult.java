package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Server health check result. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class HealthResult {
    private String status;
    private String version;

    public HealthResult() {}

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getVersion() { return version; }
    public void setVersion(String version) { this.version = version; }
}
