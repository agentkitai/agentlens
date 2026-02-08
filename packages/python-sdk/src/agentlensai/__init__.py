"""AgentLens Python SDK — observability and audit trail for AI agents."""

__version__ = "0.4.0"

from agentlensai._init import current_session_id, init, shutdown
from agentlensai.async_client import AsyncAgentLensClient
from agentlensai.client import AgentLensClient
from agentlensai.exceptions import (
    AgentLensConnectionError,
    AgentLensError,
    AuthenticationError,
    NotFoundError,
    ValidationError,
)
from agentlensai.models import (
    AgentLensEvent,
    EventQuery,
    EventQueryResult,
    HealthResult,
    LlmAnalyticsByModel,
    LlmAnalyticsByTime,
    LlmAnalyticsParams,
    LlmAnalyticsResult,
    LlmAnalyticsSummary,
    LlmMessage,
    LogLlmCallParams,
    LogLlmCallResult,
    Session,
    SessionQuery,
    SessionQueryResult,
    TimelineResult,
    TokenUsage,
    ToolCallDef,
    ToolDef,
)

__all__ = [
    "__version__",
    # Auto-instrumentation
    "init",
    "shutdown",
    "current_session_id",
    # Clients
    "AgentLensClient",
    "AsyncAgentLensClient",
    # Models
    "AgentLensEvent",
    "EventQuery",
    "EventQueryResult",
    "HealthResult",
    "LlmAnalyticsByModel",
    "LlmAnalyticsByTime",
    "LlmAnalyticsParams",
    "LlmAnalyticsResult",
    "LlmAnalyticsSummary",
    "LlmMessage",
    "LogLlmCallParams",
    "LogLlmCallResult",
    "Session",
    "SessionQuery",
    "SessionQueryResult",
    "TimelineResult",
    "TokenUsage",
    "ToolCallDef",
    "ToolDef",
    # Exceptions
    "AgentLensConnectionError",
    "AgentLensError",
    "AuthenticationError",
    "NotFoundError",
    "ValidationError",
]
