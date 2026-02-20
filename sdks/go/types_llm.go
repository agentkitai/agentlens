package agentlens

// LlmMessage represents a message in an LLM conversation.
type LlmMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// LlmToolCall represents a tool call made by the LLM.
type LlmToolCall struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

// LlmTool represents a tool available to the LLM.
type LlmTool struct {
	Name        string         `json:"name"`
	Description *string        `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"`
}

// LlmUsage represents token usage for an LLM call.
type LlmUsage struct {
	InputTokens    int  `json:"inputTokens"`
	OutputTokens   int  `json:"outputTokens"`
	TotalTokens    int  `json:"totalTokens"`
	ThinkingTokens *int `json:"thinkingTokens,omitempty"`
}

// LogLlmCallParams contains parameters for logging an LLM call.
type LogLlmCallParams struct {
	Provider     string         `json:"provider"`
	Model        string         `json:"model"`
	Messages     []LlmMessage   `json:"messages"`
	SystemPrompt *string        `json:"systemPrompt,omitempty"`
	Completion   *string        `json:"completion"`
	ToolCalls    []LlmToolCall  `json:"toolCalls,omitempty"`
	FinishReason string         `json:"finishReason"`
	Usage        LlmUsage       `json:"usage"`
	CostUsd      float64        `json:"costUsd"`
	LatencyMs    float64        `json:"latencyMs"`
	Parameters   map[string]any `json:"parameters,omitempty"`
	Tools        []LlmTool     `json:"tools,omitempty"`
	Redact       bool           `json:"redact,omitempty"`
}

// LlmAnalyticsParams contains parameters for LLM analytics queries.
type LlmAnalyticsParams struct {
	From        *string `json:"from,omitempty"`
	To          *string `json:"to,omitempty"`
	AgentID     *string `json:"agentId,omitempty"`
	Model       *string `json:"model,omitempty"`
	Provider    *string `json:"provider,omitempty"`
	Granularity *string `json:"granularity,omitempty"`
}

// LlmAnalyticsSummary contains aggregate LLM analytics.
type LlmAnalyticsSummary struct {
	TotalCalls        int     `json:"totalCalls"`
	TotalCostUsd      float64 `json:"totalCostUsd"`
	TotalInputTokens  int     `json:"totalInputTokens"`
	TotalOutputTokens int     `json:"totalOutputTokens"`
	AvgLatencyMs      float64 `json:"avgLatencyMs"`
	AvgCostPerCall    float64 `json:"avgCostPerCall"`
}

// LlmAnalyticsByModel contains analytics broken down by model.
type LlmAnalyticsByModel struct {
	Provider     string  `json:"provider"`
	Model        string  `json:"model"`
	Calls        int     `json:"calls"`
	CostUsd      float64 `json:"costUsd"`
	InputTokens  int     `json:"inputTokens"`
	OutputTokens int     `json:"outputTokens"`
	AvgLatencyMs float64 `json:"avgLatencyMs"`
}

// LlmAnalyticsByTime contains analytics broken down by time bucket.
type LlmAnalyticsByTime struct {
	Bucket       string  `json:"bucket"`
	Calls        int     `json:"calls"`
	CostUsd      float64 `json:"costUsd"`
	InputTokens  int     `json:"inputTokens"`
	OutputTokens int     `json:"outputTokens"`
	AvgLatencyMs float64 `json:"avgLatencyMs"`
}

// LlmAnalyticsResult is the response from GetLlmAnalytics.
type LlmAnalyticsResult struct {
	Summary LlmAnalyticsSummary   `json:"summary"`
	ByModel []LlmAnalyticsByModel `json:"byModel"`
	ByTime  []LlmAnalyticsByTime  `json:"byTime"`
}
