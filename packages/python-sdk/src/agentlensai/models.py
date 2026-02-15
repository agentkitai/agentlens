"""Pydantic v2 models for the AgentLens API.

All models use camelCase aliases for JSON serialization to match the server API,
while exposing snake_case attributes in Python.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

# ─── Literal Types ───────────────────────────────────────────────────────────

EventType = Literal[
    "session_started",
    "session_ended",
    "tool_call",
    "tool_response",
    "tool_error",
    "approval_requested",
    "approval_granted",
    "approval_denied",
    "approval_expired",
    "form_submitted",
    "form_completed",
    "form_expired",
    "cost_tracked",
    "llm_call",
    "llm_response",
    "alert_triggered",
    "alert_resolved",
    "custom",
]

EventSeverity = Literal["debug", "info", "warn", "error", "critical"]
SessionStatus = Literal["active", "completed", "error"]
OrderDirection = Literal["asc", "desc"]
Granularity = Literal["hour", "day", "week"]

# ─── Base Model ──────────────────────────────────────────────────────────────


class _BaseModel(BaseModel):
    """Base model with camelCase alias generation for JSON serialization."""

    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
    )


# ─── Core Models ─────────────────────────────────────────────────────────────


class TokenUsage(_BaseModel):
    """Token usage statistics for an LLM call."""

    input_tokens: int
    output_tokens: int
    total_tokens: int
    thinking_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None


class ToolCallDef(_BaseModel):
    """A tool call definition (as returned by an LLM)."""

    id: str
    name: str
    arguments: dict[str, Any]


class LlmMessage(_BaseModel):
    """A single message in an LLM conversation."""

    role: Literal["system", "user", "assistant", "tool"]
    content: str | list[dict[str, Any]]
    tool_call_id: str | None = None
    tool_calls: list[ToolCallDef] | None = None


class ToolDef(_BaseModel):
    """A tool/function definition provided to the model."""

    name: str
    description: str | None = None
    parameters: dict[str, Any] | None = None


class Agent(_BaseModel):
    """Agent record with guardrail-related fields."""

    id: str
    name: str
    description: str | None = None
    first_seen_at: str
    last_seen_at: str
    session_count: int
    tenant_id: str
    model_override: str | None = None
    paused_at: str | None = None
    pause_reason: str | None = None


class AgentLensEvent(_BaseModel):
    """The core event record — the fundamental unit of data in AgentLens."""

    id: str
    timestamp: str
    session_id: str
    agent_id: str
    event_type: EventType
    severity: EventSeverity
    payload: dict[str, Any]
    metadata: dict[str, Any]
    prev_hash: str | None
    hash: str


class Session(_BaseModel):
    """Agent session — materialized from session_started/session_ended events."""

    id: str
    agent_id: str
    agent_name: str | None = None
    started_at: str
    ended_at: str | None = None
    status: SessionStatus
    event_count: int
    tool_call_count: int
    error_count: int
    total_cost_usd: float
    llm_call_count: int
    total_input_tokens: int
    total_output_tokens: int
    tags: list[str]


# ─── Query Models ────────────────────────────────────────────────────────────


class EventQuery(_BaseModel):
    """Parameters for querying events."""

    session_id: str | None = None
    agent_id: str | None = None
    event_type: EventType | list[EventType] | None = None
    severity: EventSeverity | list[EventSeverity] | None = None
    from_time: str | None = Field(default=None, alias="from")
    to: str | None = None
    limit: int | None = None
    offset: int | None = None
    order: OrderDirection | None = None
    search: str | None = None


class EventQueryResult(_BaseModel):
    """Result of an event query."""

    events: list[AgentLensEvent]
    total: int
    has_more: bool


class SessionQuery(_BaseModel):
    """Parameters for querying sessions."""

    agent_id: str | None = None
    status: SessionStatus | list[SessionStatus] | None = None
    from_time: str | None = Field(default=None, alias="from")
    to: str | None = None
    limit: int | None = None
    offset: int | None = None
    tags: list[str] | None = None


class SessionQueryResult(_BaseModel):
    """Result of a session query."""

    sessions: list[Session]
    total: int
    has_more: bool = False


class TimelineResult(_BaseModel):
    """Result of a session timeline query."""

    events: list[AgentLensEvent]
    chain_valid: bool


class HealthResult(_BaseModel):
    """Health check response."""

    status: str
    version: str


# ─── LLM-specific Models ────────────────────────────────────────────────────


class LogLlmCallParams(_BaseModel):
    """Parameters for logging an LLM call."""

    provider: str
    model: str
    messages: list[LlmMessage]
    system_prompt: str | None = None
    completion: str | None
    tool_calls: list[ToolCallDef] | None = None
    finish_reason: str
    usage: TokenUsage
    cost_usd: float
    latency_ms: float
    parameters: dict[str, Any] | None = None
    tools: list[ToolDef] | None = None
    redact: bool | None = None


class LogLlmCallResult(_BaseModel):
    """Result of logging an LLM call."""

    call_id: str


class LlmAnalyticsParams(_BaseModel):
    """Parameters for querying LLM analytics."""

    from_time: str | None = Field(default=None, alias="from")
    to_time: str | None = Field(default=None, alias="to")
    agent_id: str | None = None
    model: str | None = None
    provider: str | None = None
    granularity: Granularity | None = None


class LlmAnalyticsSummary(_BaseModel):
    """Summary statistics for LLM analytics."""

    total_calls: int
    total_cost_usd: float
    total_input_tokens: int
    total_output_tokens: int
    avg_latency_ms: float
    avg_cost_per_call: float


class LlmAnalyticsByModel(_BaseModel):
    """LLM analytics broken down by model."""

    provider: str
    model: str
    calls: int
    cost_usd: float
    input_tokens: int
    output_tokens: int
    avg_latency_ms: float


class LlmAnalyticsByTime(_BaseModel):
    """LLM analytics broken down by time bucket."""

    bucket: str
    calls: int
    cost_usd: float
    input_tokens: int
    output_tokens: int
    avg_latency_ms: float


class LlmAnalyticsResult(_BaseModel):
    """Full LLM analytics result."""

    summary: LlmAnalyticsSummary
    by_model: list[LlmAnalyticsByModel]
    by_time: list[LlmAnalyticsByTime]


# ─── Recall / Semantic Search Models (Epic 6) ───────────────────────────────

LessonImportance = Literal["low", "normal", "high", "critical"]
ReflectAnalysis = Literal[
    "error_patterns",
    "tool_sequences",
    "cost_analysis",
    "performance_trends",
    "session_comparison",
]


class RecallQuery(_BaseModel):
    """Query for semantic search over embeddings."""

    query: str
    scope: str | None = None
    agent_id: str | None = None
    from_time: str | None = Field(default=None, alias="from")
    to: str | None = None
    limit: int | None = None
    min_score: float | None = None


class RecallResultItem(_BaseModel):
    """A single semantic search result."""

    source_type: str
    source_id: str
    score: float
    text: str
    metadata: dict[str, Any] | None = None


class RecallResult(_BaseModel):
    """Result of a recall (semantic search) query."""

    results: list[RecallResultItem]
    query: str
    total_results: int


# ─── Lesson Models (Epic 6) ─────────────────────────────────────────────────


class Lesson(_BaseModel):
    """A distilled lesson / insight from agent experience."""

    id: str
    tenant_id: str
    agent_id: str | None = None
    category: str
    title: str
    content: str
    context: dict[str, Any]
    importance: LessonImportance
    source_session_id: str | None = None
    source_event_id: str | None = None
    access_count: int
    last_accessed_at: str | None = None
    created_at: str
    updated_at: str
    archived_at: str | None = None


class LessonQuery(_BaseModel):
    """Query filters for listing lessons."""

    agent_id: str | None = None
    category: str | None = None
    importance: LessonImportance | None = None
    search: str | None = None
    limit: int | None = None
    offset: int | None = None
    include_archived: bool | None = None


class CreateLessonInput(_BaseModel):
    """Input for creating a new lesson."""

    title: str
    content: str
    category: str | None = None
    importance: LessonImportance | None = None
    agent_id: str | None = None
    context: dict[str, Any] | None = None
    source_session_id: str | None = None
    source_event_id: str | None = None


class LessonListResult(_BaseModel):
    """Result of listing lessons."""

    lessons: list[Lesson]
    total: int


class DeleteLessonResult(_BaseModel):
    """Result of deleting (archiving) a lesson."""

    id: str
    archived: bool


# ─── Reflect / Pattern Analysis Models (Epic 6) ─────────────────────────────


class ReflectQuery(_BaseModel):
    """Query input for the reflect endpoint."""

    analysis: ReflectAnalysis
    agent_id: str | None = None
    from_time: str | None = Field(default=None, alias="from")
    to: str | None = None
    limit: int | None = None


class ReflectInsight(_BaseModel):
    """Structured insight returned from analysis."""

    type: str
    summary: str
    data: dict[str, Any]
    confidence: float


class ReflectMetadata(_BaseModel):
    """Metadata about the reflect analysis."""

    sessions_analyzed: int
    events_analyzed: int
    time_range: dict[str, str]


class ReflectResult(_BaseModel):
    """Result envelope from the reflect endpoint."""

    analysis: ReflectAnalysis
    insights: list[ReflectInsight]
    metadata: ReflectMetadata


# ─── Context Models (Epic 6) ────────────────────────────────────────────────


class ContextQuery(_BaseModel):
    """Query for cross-session context retrieval."""

    topic: str
    user_id: str | None = None
    agent_id: str | None = None
    limit: int | None = None


class ContextKeyEvent(_BaseModel):
    """A key event within a context session."""

    id: str
    event_type: str
    summary: str
    timestamp: str


class ContextSession(_BaseModel):
    """A session included in context results."""

    session_id: str
    agent_id: str
    started_at: str
    ended_at: str | None = None
    summary: str | None = None
    relevance_score: float
    key_events: list[ContextKeyEvent]


class ContextLesson(_BaseModel):
    """A lesson relevant to the context query."""

    id: str
    title: str
    content: str
    category: str
    importance: LessonImportance
    relevance_score: float


class ContextResult(_BaseModel):
    """Result of a context query."""

    topic: str
    sessions: list[ContextSession]
    lessons: list[ContextLesson]
    summary: str | None = None


# ─── Health Score & Optimization Models (Story 3.2) ─────────────────────────

TrendDirection = Literal["improving", "degrading", "stable"]


class HealthDimension(_BaseModel):
    """A single dimension contributing to an agent's health score."""

    name: str
    score: float
    weight: float
    trend: str
    raw_value: float
    description: str


class HealthTrend(_BaseModel):
    """Trend information for a health score."""

    direction: TrendDirection
    delta: float
    previous_score: float


class HealthScore(_BaseModel):
    """Computed health score for an agent."""

    agent_id: str
    overall_score: float
    dimensions: list[HealthDimension]
    trend: HealthTrend
    computed_at: str
    window_days: int


class HealthSnapshot(_BaseModel):
    """A single daily health snapshot for an agent."""

    agent_id: str
    date: str
    overall_score: float
    error_rate_score: float
    cost_efficiency_score: float
    tool_success_score: float
    latency_score: float
    completion_rate_score: float
    session_count: int


class HealthHistoryResult(_BaseModel):
    """Result of GET /api/health/history."""

    snapshots: list[HealthSnapshot]
    agent_id: str
    days: int


class CostRecommendation(_BaseModel):
    """A single cost-optimization recommendation."""

    current_model: str
    recommended_model: str
    complexity_tier: str
    current_cost_per_call: float
    recommended_cost_per_call: float
    monthly_savings: float
    call_volume: int
    current_success_rate: float
    recommended_success_rate: float
    confidence: float
    agent_id: str


class OptimizationResult(_BaseModel):
    """Result of optimization recommendations analysis."""

    recommendations: list[CostRecommendation]
    total_potential_savings: float
    period: int
    analyzed_calls: int


# ─── Guardrail Models (v0.8.0 — Phase 3) ───────────────────────────

GuardrailConditionType = Literal[
    "error_rate_threshold",
    "cost_limit",
    "health_score_threshold",
    "custom_metric",
]

GuardrailActionType = Literal[
    "pause_agent",
    "notify_webhook",
    "downgrade_model",
    "agentgate_policy",
]


class GuardrailRule(_BaseModel):
    """A guardrail rule — configurable condition + action with cooldown."""

    id: str
    tenant_id: str
    name: str
    description: str | None = None
    enabled: bool
    condition_type: GuardrailConditionType
    condition_config: dict[str, Any]
    action_type: GuardrailActionType
    action_config: dict[str, Any]
    agent_id: str | None = None
    cooldown_minutes: int
    dry_run: bool
    created_at: str
    updated_at: str


class GuardrailRuleListResult(_BaseModel):
    """Result of listing guardrail rules."""

    rules: list[GuardrailRule]


class GuardrailState(_BaseModel):
    """Runtime state for a guardrail rule."""

    rule_id: str
    tenant_id: str
    last_triggered_at: str | None = None
    trigger_count: int
    last_evaluated_at: str | None = None
    current_value: float | None = None


class GuardrailTriggerHistory(_BaseModel):
    """Record of a guardrail trigger event."""

    id: str
    rule_id: str
    tenant_id: str
    triggered_at: str
    condition_value: float
    condition_threshold: float
    action_executed: bool
    action_result: str | None = None
    metadata: dict[str, Any]


class GuardrailTriggerHistoryResult(_BaseModel):
    """Result of listing guardrail trigger history."""

    triggers: list[GuardrailTriggerHistory]
    total: int


class GuardrailStatusResult(_BaseModel):
    """Result of getting guardrail rule status."""

    rule: GuardrailRule
    state: GuardrailState | None = None
    recent_triggers: list[GuardrailTriggerHistory]


class GuardrailDeleteResult(_BaseModel):
    """Result of deleting a guardrail rule."""

    ok: bool
