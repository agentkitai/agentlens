package ai.agentlens.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.Map;

/** Parameters for logging an LLM call. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class LogLlmCallParams {
    private String provider;
    private String model;
    private List<LlmMessage> messages;
    private String systemPrompt;
    private String completion;
    private List<ToolCall> toolCalls;
    private String finishReason;
    private Usage usage;
    private double costUsd;
    private long latencyMs;
    private Map<String, Object> parameters;
    private List<ToolDef> tools;
    private Boolean redact;

    public LogLlmCallParams() {}

    public String getProvider() { return provider; }
    public LogLlmCallParams setProvider(String v) { this.provider = v; return this; }
    public String getModel() { return model; }
    public LogLlmCallParams setModel(String v) { this.model = v; return this; }
    public List<LlmMessage> getMessages() { return messages; }
    public LogLlmCallParams setMessages(List<LlmMessage> v) { this.messages = v; return this; }
    public String getSystemPrompt() { return systemPrompt; }
    public LogLlmCallParams setSystemPrompt(String v) { this.systemPrompt = v; return this; }
    public String getCompletion() { return completion; }
    public LogLlmCallParams setCompletion(String v) { this.completion = v; return this; }
    public List<ToolCall> getToolCalls() { return toolCalls; }
    public LogLlmCallParams setToolCalls(List<ToolCall> v) { this.toolCalls = v; return this; }
    public String getFinishReason() { return finishReason; }
    public LogLlmCallParams setFinishReason(String v) { this.finishReason = v; return this; }
    public Usage getUsage() { return usage; }
    public LogLlmCallParams setUsage(Usage v) { this.usage = v; return this; }
    public double getCostUsd() { return costUsd; }
    public LogLlmCallParams setCostUsd(double v) { this.costUsd = v; return this; }
    public long getLatencyMs() { return latencyMs; }
    public LogLlmCallParams setLatencyMs(long v) { this.latencyMs = v; return this; }
    public Map<String, Object> getParameters() { return parameters; }
    public LogLlmCallParams setParameters(Map<String, Object> v) { this.parameters = v; return this; }
    public List<ToolDef> getTools() { return tools; }
    public LogLlmCallParams setTools(List<ToolDef> v) { this.tools = v; return this; }
    public Boolean getRedact() { return redact; }
    public LogLlmCallParams setRedact(Boolean v) { this.redact = v; return this; }

    /** LLM message. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class LlmMessage {
        private String role;
        private String content;

        public LlmMessage() {}
        public LlmMessage(String role, String content) {
            this.role = role;
            this.content = content;
        }

        public String getRole() { return role; }
        public void setRole(String role) { this.role = role; }
        public String getContent() { return content; }
        public void setContent(String content) { this.content = content; }
    }

    /** Tool call. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class ToolCall {
        private String id;
        private String name;
        private Map<String, Object> arguments;

        public ToolCall() {}
        public String getId() { return id; }
        public void setId(String id) { this.id = id; }
        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public Map<String, Object> getArguments() { return arguments; }
        public void setArguments(Map<String, Object> arguments) { this.arguments = arguments; }
    }

    /** Tool definition. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class ToolDef {
        private String name;
        private String description;
        private Map<String, Object> parameters;

        public ToolDef() {}
        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public String getDescription() { return description; }
        public void setDescription(String description) { this.description = description; }
        public Map<String, Object> getParameters() { return parameters; }
        public void setParameters(Map<String, Object> parameters) { this.parameters = parameters; }
    }

    /** Token usage. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Usage {
        private int inputTokens;
        private int outputTokens;
        private int totalTokens;
        private Integer thinkingTokens;

        public Usage() {}
        public Usage(int inputTokens, int outputTokens, int totalTokens) {
            this.inputTokens = inputTokens;
            this.outputTokens = outputTokens;
            this.totalTokens = totalTokens;
        }

        public int getInputTokens() { return inputTokens; }
        public void setInputTokens(int v) { this.inputTokens = v; }
        public int getOutputTokens() { return outputTokens; }
        public void setOutputTokens(int v) { this.outputTokens = v; }
        public int getTotalTokens() { return totalTokens; }
        public void setTotalTokens(int v) { this.totalTokens = v; }
        public Integer getThinkingTokens() { return thinkingTokens; }
        public void setThinkingTokens(Integer v) { this.thinkingTokens = v; }
    }
}
