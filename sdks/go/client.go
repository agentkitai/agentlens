package agentlens

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"crypto/rand"
	"encoding/hex"
)

// Client is the AgentLens API client.
type Client struct {
	cfg clientConfig
}

// NewClient creates a new Client with the given server URL and API key.
func NewClient(serverURL, apiKey string, opts ...ClientOption) *Client {
	cfg := defaultConfig()
	cfg.url = strings.TrimRight(serverURL, "/")
	cfg.apiKey = apiKey
	for _, o := range opts {
		o(&cfg)
	}
	if cfg.httpClient == nil {
		cfg.httpClient = &http.Client{Timeout: cfg.timeout}
	}
	return &Client{cfg: cfg}
}

// NewClientFromEnv creates a Client from AGENTLENS_SERVER_URL and AGENTLENS_API_KEY environment variables.
func NewClientFromEnv(opts ...ClientOption) *Client {
	u := os.Getenv("AGENTLENS_SERVER_URL")
	if u == "" {
		u = "http://localhost:3400"
	}
	return NewClient(u, os.Getenv("AGENTLENS_API_KEY"), opts...)
}

// do is the internal HTTP method with retry logic.
func (c *Client) do(ctx context.Context, method, path string, body any, result any, skipAuth bool) error {
	var bodyReader func() (io.Reader, error)
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("agentlens: marshal request body: %w", err)
		}
		bodyReader = func() (io.Reader, error) { return bytes.NewReader(data), nil }
	}

	fullURL := c.cfg.url + path
	var lastErr error

	for attempt := 0; attempt <= c.cfg.retry.MaxRetries; attempt++ {
		if attempt > 0 {
			// Calculate delay
			var delay time.Duration
			if rlErr, ok := lastErr.(*RateLimitError); ok && rlErr.RetryAfter != nil {
				delay = time.Duration(*rlErr.RetryAfter * float64(time.Second))
			} else {
				delay = backoffDelay(c.cfg.retry, attempt-1)
			}
			select {
			case <-ctx.Done():
				return &ConnectionError{
					APIError: newAPIError(ctx.Err().Error(), 0, "CONNECTION_ERROR", nil),
					Cause: ctx.Err(),
				}
			case <-time.After(delay):
			}
		}

		var reqBody io.Reader
		if bodyReader != nil {
			var err error
			reqBody, err = bodyReader()
			if err != nil {
				return err
			}
		}

		req, err := http.NewRequestWithContext(ctx, method, fullURL, reqBody)
		if err != nil {
			return fmt.Errorf("agentlens: create request: %w", err)
		}

		req.Header.Set("Accept", "application/json")
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if !skipAuth && c.cfg.apiKey != "" {
			req.Header.Set("Authorization", "Bearer "+c.cfg.apiKey)
		}

		resp, err := c.cfg.httpClient.Do(req)
		if err != nil {
			lastErr = &ConnectionError{
				APIError: newAPIError(fmt.Sprintf("request failed: %v", err), 0, "CONNECTION_ERROR", nil),
				Cause: err,
			}
			if ctx.Err() != nil {
				return lastErr // context cancelled, don't retry
			}
			continue
		}

		respBody, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = &ConnectionError{
				APIError: newAPIError(fmt.Sprintf("read response: %v", err), 0, "CONNECTION_ERROR", nil),
				Cause: err,
			}
			continue
		}

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			if result != nil && len(respBody) > 0 {
				if err := json.Unmarshal(respBody, result); err != nil {
					return fmt.Errorf("agentlens: unmarshal response: %w", err)
				}
			}
			return nil
		}

		// Parse error response
		var errResp struct {
			Error   string `json:"error"`
			Details any    `json:"details"`
		}
		message := fmt.Sprintf("HTTP %d", resp.StatusCode)
		var details any
		if json.Unmarshal(respBody, &errResp) == nil && errResp.Error != "" {
			message = errResp.Error
			details = errResp.Details
		}

		// Parse Retry-After for 429
		var retryAfter *float64
		if resp.StatusCode == 429 {
			if ra := resp.Header.Get("Retry-After"); ra != "" {
				if v, err := strconv.ParseFloat(ra, 64); err == nil {
					retryAfter = &v
				}
			}
		}

		apiErr := mapHTTPError(resp.StatusCode, message, details, retryAfter)
		if shouldRetry(apiErr) {
			lastErr = apiErr
			continue
		}
		return apiErr
	}
	return lastErr
}

// doFailOpen wraps do with fail-open logic.
func (c *Client) doFailOpen(ctx context.Context, method, path string, body any, result any, skipAuth bool) error {
	err := c.do(ctx, method, path, body, result, skipAuth)
	if err != nil && c.cfg.failOpen {
		if c.cfg.onError != nil {
			c.cfg.onError(err)
		}
		return nil
	}
	return err
}

// helper to build query strings
func addQueryParam(params *url.Values, key string, val *string) {
	if val != nil {
		params.Set(key, *val)
	}
}

func addQueryInt(params *url.Values, key string, val *int) {
	if val != nil {
		params.Set(key, strconv.Itoa(*val))
	}
}

func addQueryFloat(params *url.Values, key string, val *float64) {
	if val != nil {
		params.Set(key, strconv.FormatFloat(*val, 'f', -1, 64))
	}
}

// ──── Events ────

// QueryEvents queries events with filters and pagination.
func (c *Client) QueryEvents(ctx context.Context, q *EventQuery) (*EventQueryResult, error) {
	p := url.Values{}
	if q != nil {
		addQueryParam(&p, "sessionId", q.SessionID)
		addQueryParam(&p, "agentId", q.AgentID)
		addQueryParam(&p, "eventType", q.EventType)
		addQueryParam(&p, "severity", q.Severity)
		addQueryParam(&p, "from", q.From)
		addQueryParam(&p, "to", q.To)
		addQueryParam(&p, "search", q.Search)
		addQueryInt(&p, "limit", q.Limit)
		addQueryInt(&p, "offset", q.Offset)
		addQueryParam(&p, "order", q.Order)
	}
	path := "/api/events"
	if qs := p.Encode(); qs != "" {
		path += "?" + qs
	}
	var result EventQueryResult
	err := c.doFailOpen(ctx, http.MethodGet, path, nil, &result, false)
	return &result, err
}

// GetEvent gets a single event by ID.
func (c *Client) GetEvent(ctx context.Context, id string) (*Event, error) {
	var result Event
	err := c.doFailOpen(ctx, http.MethodGet, "/api/events/"+url.PathEscape(id), nil, &result, false)
	return &result, err
}

// ──── Sessions ────

// GetSessions queries sessions with filters and pagination.
func (c *Client) GetSessions(ctx context.Context, q *SessionQuery) (*SessionQueryResult, error) {
	p := url.Values{}
	if q != nil {
		addQueryParam(&p, "agentId", q.AgentID)
		addQueryParam(&p, "status", q.Status)
		addQueryParam(&p, "from", q.From)
		addQueryParam(&p, "to", q.To)
		addQueryParam(&p, "tags", q.Tags)
		addQueryInt(&p, "limit", q.Limit)
		addQueryInt(&p, "offset", q.Offset)
	}
	path := "/api/sessions"
	if qs := p.Encode(); qs != "" {
		path += "?" + qs
	}
	var result SessionQueryResult
	err := c.doFailOpen(ctx, http.MethodGet, path, nil, &result, false)
	return &result, err
}

// GetSession gets a single session by ID.
func (c *Client) GetSession(ctx context.Context, id string) (*Session, error) {
	var result Session
	err := c.doFailOpen(ctx, http.MethodGet, "/api/sessions/"+url.PathEscape(id), nil, &result, false)
	return &result, err
}

// GetSessionTimeline gets the full event timeline for a session.
func (c *Client) GetSessionTimeline(ctx context.Context, id string) (*TimelineResult, error) {
	var result TimelineResult
	err := c.doFailOpen(ctx, http.MethodGet, "/api/sessions/"+url.PathEscape(id)+"/timeline", nil, &result, false)
	return &result, err
}

// ──── Agents ────

// GetAgent gets an agent by ID.
func (c *Client) GetAgent(ctx context.Context, id string) (*Agent, error) {
	var result Agent
	err := c.doFailOpen(ctx, http.MethodGet, "/api/agents/"+url.PathEscape(id), nil, &result, false)
	return &result, err
}

// ──── LLM ────

// generateID generates a random hex ID.
func generateID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// LogLlmCall logs a complete LLM call by sending paired events.
func (c *Client) LogLlmCall(ctx context.Context, sessionID, agentID string, params *LogLlmCallParams) (string, error) {
	callID := generateID()
	timestamp := time.Now().UTC().Format(time.RFC3339Nano)

	messages := params.Messages
	systemPrompt := params.SystemPrompt
	completion := params.Completion
	if params.Redact {
		redacted := make([]LlmMessage, len(params.Messages))
		for i, m := range params.Messages {
			redacted[i] = LlmMessage{Role: m.Role, Content: "[REDACTED]"}
		}
		messages = redacted
		if systemPrompt != nil {
			r := "[REDACTED]"
			systemPrompt = &r
		}
		if completion != nil {
			r := "[REDACTED]"
			completion = &r
		}
	}

	llmCallPayload := map[string]any{
		"callId":   callID,
		"provider": params.Provider,
		"model":    params.Model,
		"messages": messages,
	}
	if systemPrompt != nil {
		llmCallPayload["systemPrompt"] = *systemPrompt
	}
	if params.Parameters != nil {
		llmCallPayload["parameters"] = params.Parameters
	}
	if params.Tools != nil {
		llmCallPayload["tools"] = params.Tools
	}
	if params.Redact {
		llmCallPayload["redacted"] = true
	}

	llmResponsePayload := map[string]any{
		"callId":       callID,
		"provider":     params.Provider,
		"model":        params.Model,
		"completion":   completion,
		"finishReason": params.FinishReason,
		"usage":        params.Usage,
		"costUsd":      params.CostUsd,
		"latencyMs":    params.LatencyMs,
	}
	if params.ToolCalls != nil {
		llmResponsePayload["toolCalls"] = params.ToolCalls
	}
	if params.Redact {
		llmResponsePayload["redacted"] = true
	}

	body := map[string]any{
		"events": []map[string]any{
			{
				"sessionId": sessionID,
				"agentId":   agentID,
				"eventType": "llm_call",
				"severity":  "info",
				"payload":   llmCallPayload,
				"metadata":  map[string]any{},
				"timestamp": timestamp,
			},
			{
				"sessionId": sessionID,
				"agentId":   agentID,
				"eventType": "llm_response",
				"severity":  "info",
				"payload":   llmResponsePayload,
				"metadata":  map[string]any{},
				"timestamp": timestamp,
			},
		},
	}

	err := c.doFailOpen(ctx, http.MethodPost, "/api/events", body, nil, false)
	return callID, err
}

// SendEvents sends a batch of events to the server. Useful as the sendFn for BatchSender.
func (c *Client) SendEvents(ctx context.Context, events []Event) error {
	body := map[string]any{"events": events}
	return c.do(ctx, http.MethodPost, "/api/events", body, nil, false)
}

// GetLlmAnalytics gets LLM analytics.
func (c *Client) GetLlmAnalytics(ctx context.Context, params *LlmAnalyticsParams) (*LlmAnalyticsResult, error) {
	p := url.Values{}
	if params != nil {
		addQueryParam(&p, "from", params.From)
		addQueryParam(&p, "to", params.To)
		addQueryParam(&p, "agentId", params.AgentID)
		addQueryParam(&p, "model", params.Model)
		addQueryParam(&p, "provider", params.Provider)
		addQueryParam(&p, "granularity", params.Granularity)
	}
	path := "/api/analytics/llm"
	if qs := p.Encode(); qs != "" {
		path += "?" + qs
	}
	var result LlmAnalyticsResult
	err := c.doFailOpen(ctx, http.MethodGet, path, nil, &result, false)
	return &result, err
}

// ──── Recall / Reflect / Context ────

// Recall performs semantic search.
func (c *Client) Recall(ctx context.Context, q *RecallQuery) (*RecallResult, error) {
	p := url.Values{}
	p.Set("query", q.Query)
	addQueryParam(&p, "scope", q.Scope)
	addQueryParam(&p, "agentId", q.AgentID)
	addQueryParam(&p, "from", q.From)
	addQueryParam(&p, "to", q.To)
	addQueryInt(&p, "limit", q.Limit)
	addQueryFloat(&p, "minScore", q.MinScore)
	var result RecallResult
	err := c.doFailOpen(ctx, http.MethodGet, "/api/recall?"+p.Encode(), nil, &result, false)
	return &result, err
}

// Reflect performs pattern analysis.
func (c *Client) Reflect(ctx context.Context, q *ReflectQuery) (*ReflectResult, error) {
	p := url.Values{}
	p.Set("analysis", q.Analysis)
	addQueryParam(&p, "agentId", q.AgentID)
	addQueryParam(&p, "from", q.From)
	addQueryParam(&p, "to", q.To)
	addQueryInt(&p, "limit", q.Limit)
	addQueryParam(&p, "params", q.Params)
	var result ReflectResult
	err := c.doFailOpen(ctx, http.MethodGet, "/api/reflect?"+p.Encode(), nil, &result, false)
	return &result, err
}

// GetContext gets cross-session context for a topic.
func (c *Client) GetContext(ctx context.Context, q *ContextQuery) (*ContextResult, error) {
	p := url.Values{}
	p.Set("topic", q.Topic)
	addQueryParam(&p, "userId", q.UserID)
	addQueryParam(&p, "agentId", q.AgentID)
	addQueryParam(&p, "from", q.From)
	addQueryParam(&p, "to", q.To)
	addQueryInt(&p, "limit", q.Limit)
	var result ContextResult
	err := c.doFailOpen(ctx, http.MethodGet, "/api/context?"+p.Encode(), nil, &result, false)
	return &result, err
}

// ──── Health ────

// Health checks server health (no auth required).
func (c *Client) Health(ctx context.Context) (*HealthResult, error) {
	var result HealthResult
	err := c.doFailOpen(ctx, http.MethodGet, "/api/health", nil, &result, true)
	return &result, err
}

// GetHealth gets the health score for a single agent.
func (c *Client) GetHealth(ctx context.Context, agentID string, window *int) (*HealthScore, error) {
	p := url.Values{}
	addQueryInt(&p, "window", window)
	path := "/api/agents/" + url.PathEscape(agentID) + "/health"
	if qs := p.Encode(); qs != "" {
		path += "?" + qs
	}
	var result HealthScore
	err := c.doFailOpen(ctx, http.MethodGet, path, nil, &result, false)
	return &result, err
}

// GetHealthOverview gets health scores for all agents.
func (c *Client) GetHealthOverview(ctx context.Context, window *int) ([]HealthScore, error) {
	p := url.Values{}
	addQueryInt(&p, "window", window)
	path := "/api/health/overview"
	if qs := p.Encode(); qs != "" {
		path += "?" + qs
	}
	var result []HealthScore
	err := c.doFailOpen(ctx, http.MethodGet, path, nil, &result, false)
	return result, err
}

// GetHealthHistory gets historical health snapshots for an agent.
func (c *Client) GetHealthHistory(ctx context.Context, agentID string, days *int) ([]HealthSnapshot, error) {
	p := url.Values{}
	p.Set("agentId", agentID)
	addQueryInt(&p, "days", days)
	var result []HealthSnapshot
	err := c.doFailOpen(ctx, http.MethodGet, "/api/health/history?"+p.Encode(), nil, &result, false)
	return result, err
}

// ──── Optimization ────

// GetOptimizationRecommendations gets cost optimization recommendations.
func (c *Client) GetOptimizationRecommendations(ctx context.Context, opts *OptimizationOpts) (*OptimizationResult, error) {
	p := url.Values{}
	if opts != nil {
		addQueryParam(&p, "agentId", opts.AgentID)
		addQueryInt(&p, "period", opts.Period)
		addQueryInt(&p, "limit", opts.Limit)
	}
	path := "/api/optimize/recommendations"
	if qs := p.Encode(); qs != "" {
		path += "?" + qs
	}
	var result OptimizationResult
	err := c.doFailOpen(ctx, http.MethodGet, path, nil, &result, false)
	return &result, err
}

// ──── Guardrails ────

// ListGuardrails lists all guardrail rules.
func (c *Client) ListGuardrails(ctx context.Context, opts *GuardrailListOpts) (*GuardrailRuleListResult, error) {
	p := url.Values{}
	if opts != nil {
		addQueryParam(&p, "agentId", opts.AgentID)
	}
	path := "/api/guardrails"
	if qs := p.Encode(); qs != "" {
		path += "?" + qs
	}
	var result GuardrailRuleListResult
	err := c.doFailOpen(ctx, http.MethodGet, path, nil, &result, false)
	return &result, err
}

// GetGuardrail gets a guardrail rule by ID.
func (c *Client) GetGuardrail(ctx context.Context, id string) (*GuardrailRule, error) {
	var result GuardrailRule
	err := c.doFailOpen(ctx, http.MethodGet, "/api/guardrails/"+url.PathEscape(id), nil, &result, false)
	return &result, err
}

// CreateGuardrail creates a new guardrail rule.
func (c *Client) CreateGuardrail(ctx context.Context, params *CreateGuardrailParams) (*GuardrailRule, error) {
	var result GuardrailRule
	err := c.doFailOpen(ctx, http.MethodPost, "/api/guardrails", params, &result, false)
	return &result, err
}

// UpdateGuardrail updates a guardrail rule.
func (c *Client) UpdateGuardrail(ctx context.Context, id string, params *UpdateGuardrailParams) (*GuardrailRule, error) {
	var result GuardrailRule
	err := c.doFailOpen(ctx, http.MethodPut, "/api/guardrails/"+url.PathEscape(id), params, &result, false)
	return &result, err
}

// DeleteGuardrail deletes a guardrail rule.
func (c *Client) DeleteGuardrail(ctx context.Context, id string) error {
	return c.doFailOpen(ctx, http.MethodDelete, "/api/guardrails/"+url.PathEscape(id), nil, nil, false)
}

// EnableGuardrail enables a guardrail rule.
func (c *Client) EnableGuardrail(ctx context.Context, id string) (*GuardrailRule, error) {
	enabled := true
	return c.UpdateGuardrail(ctx, id, &UpdateGuardrailParams{Enabled: &enabled})
}

// DisableGuardrail disables a guardrail rule.
func (c *Client) DisableGuardrail(ctx context.Context, id string) (*GuardrailRule, error) {
	enabled := false
	return c.UpdateGuardrail(ctx, id, &UpdateGuardrailParams{Enabled: &enabled})
}

// GetGuardrailHistory gets trigger history for guardrail rules.
func (c *Client) GetGuardrailHistory(ctx context.Context, opts *GuardrailHistoryOpts) (*GuardrailTriggerHistoryResult, error) {
	p := url.Values{}
	if opts != nil {
		addQueryParam(&p, "ruleId", opts.RuleID)
		addQueryInt(&p, "limit", opts.Limit)
		addQueryInt(&p, "offset", opts.Offset)
	}
	path := "/api/guardrails/history"
	if qs := p.Encode(); qs != "" {
		path += "?" + qs
	}
	var result GuardrailTriggerHistoryResult
	err := c.doFailOpen(ctx, http.MethodGet, path, nil, &result, false)
	return &result, err
}

// GetGuardrailStatus gets status and recent triggers for a guardrail rule.
func (c *Client) GetGuardrailStatus(ctx context.Context, id string) (*GuardrailStatusResult, error) {
	var result GuardrailStatusResult
	err := c.doFailOpen(ctx, http.MethodGet, "/api/guardrails/"+url.PathEscape(id)+"/status", nil, &result, false)
	return &result, err
}

// ──── Audit ────

// VerifyAudit verifies audit trail hash chain integrity.
func (c *Client) VerifyAudit(ctx context.Context, params *VerifyAuditParams) (*VerificationReport, error) {
	p := url.Values{}
	if params != nil {
		addQueryParam(&p, "from", params.From)
		addQueryParam(&p, "to", params.To)
		addQueryParam(&p, "sessionId", params.SessionID)
	}
	path := "/api/audit/verify"
	if qs := p.Encode(); qs != "" {
		path += "?" + qs
	}
	var result VerificationReport
	err := c.doFailOpen(ctx, http.MethodGet, path, nil, &result, false)
	return &result, err
}
