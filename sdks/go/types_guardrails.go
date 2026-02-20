package agentlens

import "time"

// GuardrailRule represents a guardrail rule.
type GuardrailRule struct {
	ID               string         `json:"id"`
	Name             string         `json:"name"`
	Description      *string        `json:"description,omitempty"`
	ConditionType    string         `json:"conditionType"`
	ConditionConfig  map[string]any `json:"conditionConfig"`
	ActionType       string         `json:"actionType"`
	ActionConfig     map[string]any `json:"actionConfig"`
	AgentID          *string        `json:"agentId,omitempty"`
	Enabled          bool           `json:"enabled"`
	DryRun           bool           `json:"dryRun"`
	CooldownMinutes  *int           `json:"cooldownMinutes,omitempty"`
	CreatedAt        time.Time      `json:"createdAt"`
	UpdatedAt        time.Time      `json:"updatedAt"`
}

// GuardrailRuleListResult is the response from ListGuardrails.
type GuardrailRuleListResult struct {
	Rules []GuardrailRule `json:"rules"`
}

// GuardrailListOpts are options for listing guardrails.
type GuardrailListOpts struct {
	AgentID *string `json:"agentId,omitempty"`
}

// CreateGuardrailParams contains parameters for creating a guardrail rule.
type CreateGuardrailParams struct {
	Name            string         `json:"name"`
	Description     *string        `json:"description,omitempty"`
	ConditionType   string         `json:"conditionType"`
	ConditionConfig map[string]any `json:"conditionConfig"`
	ActionType      string         `json:"actionType"`
	ActionConfig    map[string]any `json:"actionConfig"`
	AgentID         *string        `json:"agentId,omitempty"`
	Enabled         *bool          `json:"enabled,omitempty"`
	DryRun          *bool          `json:"dryRun,omitempty"`
	CooldownMinutes *int           `json:"cooldownMinutes,omitempty"`
}

// UpdateGuardrailParams contains parameters for updating a guardrail rule.
type UpdateGuardrailParams struct {
	Name            *string        `json:"name,omitempty"`
	Description     *string        `json:"description,omitempty"`
	ConditionType   *string        `json:"conditionType,omitempty"`
	ConditionConfig map[string]any `json:"conditionConfig,omitempty"`
	ActionType      *string        `json:"actionType,omitempty"`
	ActionConfig    map[string]any `json:"actionConfig,omitempty"`
	AgentID         *string        `json:"agentId,omitempty"`
	Enabled         *bool          `json:"enabled,omitempty"`
	DryRun          *bool          `json:"dryRun,omitempty"`
	CooldownMinutes *int           `json:"cooldownMinutes,omitempty"`
}

// GuardrailState represents the runtime state of a guardrail.
type GuardrailState struct {
	RuleID        string  `json:"ruleId"`
	TriggerCount  int     `json:"triggerCount"`
	LastTriggered *string `json:"lastTriggered,omitempty"`
}

// GuardrailTriggerHistory represents a guardrail trigger event.
type GuardrailTriggerHistory struct {
	ID        string         `json:"id"`
	RuleID    string         `json:"ruleId"`
	RuleName  string         `json:"ruleName"`
	EventID   *string        `json:"eventId,omitempty"`
	SessionID *string        `json:"sessionId,omitempty"`
	AgentID   *string        `json:"agentId,omitempty"`
	Action    string         `json:"action"`
	Details   map[string]any `json:"details,omitempty"`
	Timestamp string         `json:"timestamp"`
}

// GuardrailStatusResult is the response from GetGuardrailStatus.
type GuardrailStatusResult struct {
	Rule           GuardrailRule             `json:"rule"`
	State          *GuardrailState           `json:"state"`
	RecentTriggers []GuardrailTriggerHistory `json:"recentTriggers"`
}

// GuardrailTriggerHistoryResult is the response from GetGuardrailHistory.
type GuardrailTriggerHistoryResult struct {
	Triggers []GuardrailTriggerHistory `json:"triggers"`
	Total    int                       `json:"total"`
}

// GuardrailHistoryOpts are options for querying guardrail history.
type GuardrailHistoryOpts struct {
	RuleID *string `json:"ruleId,omitempty"`
	Limit  *int    `json:"limit,omitempty"`
	Offset *int    `json:"offset,omitempty"`
}
