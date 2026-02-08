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
