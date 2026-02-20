package agentlens

import "time"

// Event represents an AgentLens event.
type Event struct {
	ID        string         `json:"id"`
	SessionID string         `json:"sessionId"`
	AgentID   string         `json:"agentId"`
	EventType string         `json:"eventType"`
	Severity  string         `json:"severity"`
	Payload   map[string]any `json:"payload,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	Timestamp string         `json:"timestamp"`
	Hash      *string        `json:"hash,omitempty"`
	PrevHash  *string        `json:"prevHash,omitempty"`
}

// EventQuery contains filters for querying events.
type EventQuery struct {
	SessionID *string `json:"sessionId,omitempty"`
	AgentID   *string `json:"agentId,omitempty"`
	EventType *string `json:"eventType,omitempty"`
	Severity  *string `json:"severity,omitempty"`
	From      *string `json:"from,omitempty"`
	To        *string `json:"to,omitempty"`
	Search    *string `json:"search,omitempty"`
	Limit     *int    `json:"limit,omitempty"`
	Offset    *int    `json:"offset,omitempty"`
	Order     *string `json:"order,omitempty"`
}

// EventQueryResult is the response from QueryEvents.
type EventQueryResult struct {
	Events  []Event `json:"events"`
	Total   int     `json:"total"`
	HasMore bool    `json:"hasMore"`
}

// Session represents an AgentLens session.
type Session struct {
	ID        string         `json:"id"`
	AgentID   string         `json:"agentId"`
	Status    string         `json:"status"`
	Tags      []string       `json:"tags,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
}

// SessionQuery contains filters for querying sessions.
type SessionQuery struct {
	AgentID *string `json:"agentId,omitempty"`
	Status  *string `json:"status,omitempty"`
	From    *string `json:"from,omitempty"`
	To      *string `json:"to,omitempty"`
	Tags    *string `json:"tags,omitempty"`
	Limit   *int    `json:"limit,omitempty"`
	Offset  *int    `json:"offset,omitempty"`
}

// SessionQueryResult is the response from GetSessions.
type SessionQueryResult struct {
	Sessions []Session `json:"sessions"`
	Total    int       `json:"total"`
	HasMore  bool      `json:"hasMore"`
}

// TimelineResult is the response from GetSessionTimeline.
type TimelineResult struct {
	Events     []Event `json:"events"`
	ChainValid bool    `json:"chainValid"`
}

// Agent represents an AgentLens agent.
type Agent struct {
	ID            string         `json:"id"`
	Name          *string        `json:"name,omitempty"`
	ModelOverride *string        `json:"modelOverride,omitempty"`
	PausedAt      *time.Time     `json:"pausedAt,omitempty"`
	Metadata      map[string]any `json:"metadata,omitempty"`
	CreatedAt     time.Time      `json:"createdAt"`
	UpdatedAt     time.Time      `json:"updatedAt"`
}

// HealthResult is the response from the Health endpoint.
type HealthResult struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

// HealthScore represents a health score for an agent.
type HealthScore struct {
	AgentID    string   `json:"agentId"`
	Score      float64  `json:"score"`
	Components any      `json:"components,omitempty"`
	Window     *int     `json:"window,omitempty"`
	UpdatedAt  *string  `json:"updatedAt,omitempty"`
}

// HealthSnapshot represents a historical health snapshot.
type HealthSnapshot struct {
	AgentID    string  `json:"agentId"`
	Score      float64 `json:"score"`
	Components any     `json:"components,omitempty"`
	Timestamp  string  `json:"timestamp"`
}

// OptimizationOpts are options for optimization recommendations.
type OptimizationOpts struct {
	AgentID *string `json:"agentId,omitempty"`
	Period  *int    `json:"period,omitempty"`
	Limit   *int    `json:"limit,omitempty"`
}

// OptimizationResult is the response from GetOptimizationRecommendations.
type OptimizationResult struct {
	Recommendations []any `json:"recommendations"`
}

// RecallQuery contains parameters for semantic search.
type RecallQuery struct {
	Query    string   `json:"query"`
	Scope    *string  `json:"scope,omitempty"`
	AgentID  *string  `json:"agentId,omitempty"`
	From     *string  `json:"from,omitempty"`
	To       *string  `json:"to,omitempty"`
	Limit    *int     `json:"limit,omitempty"`
	MinScore *float64 `json:"minScore,omitempty"`
}

// RecallResult is the response from Recall.
type RecallResult struct {
	Results []any `json:"results"`
}

// ReflectQuery contains parameters for pattern analysis.
type ReflectQuery struct {
	Analysis string  `json:"analysis"`
	AgentID  *string `json:"agentId,omitempty"`
	From     *string `json:"from,omitempty"`
	To       *string `json:"to,omitempty"`
	Limit    *int    `json:"limit,omitempty"`
	Params   *string `json:"params,omitempty"`
}

// ReflectResult is the response from Reflect.
type ReflectResult struct {
	Analysis any `json:"analysis"`
}

// ContextQuery contains parameters for cross-session context.
type ContextQuery struct {
	Topic   string  `json:"topic"`
	UserID  *string `json:"userId,omitempty"`
	AgentID *string `json:"agentId,omitempty"`
	From    *string `json:"from,omitempty"`
	To      *string `json:"to,omitempty"`
	Limit   *int    `json:"limit,omitempty"`
}

// ContextResult is the response from GetContext.
type ContextResult struct {
	Context any `json:"context"`
}

// VerifyAuditParams contains parameters for audit verification.
type VerifyAuditParams struct {
	From      *string `json:"from,omitempty"`
	To        *string `json:"to,omitempty"`
	SessionID *string `json:"sessionId,omitempty"`
}

// BrokenChainDetail describes a broken hash chain.
type BrokenChainDetail struct {
	SessionID     string `json:"sessionId"`
	FailedAtIndex int    `json:"failedAtIndex"`
	FailedEventID string `json:"failedEventId"`
	Reason        string `json:"reason"`
}

// VerificationReport is the response from VerifyAudit.
type VerificationReport struct {
	Verified         bool               `json:"verified"`
	VerifiedAt       string             `json:"verifiedAt"`
	Range            *VerificationRange `json:"range"`
	SessionID        *string            `json:"sessionId,omitempty"`
	SessionsVerified int                `json:"sessionsVerified"`
	TotalEvents      int                `json:"totalEvents"`
	FirstHash        *string            `json:"firstHash"`
	LastHash         *string            `json:"lastHash"`
	BrokenChains     []BrokenChainDetail `json:"brokenChains"`
	Signature        *string            `json:"signature"`
}

// VerificationRange is the time range of a verification report.
type VerificationRange struct {
	From string `json:"from"`
	To   string `json:"to"`
}
