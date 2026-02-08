"""AgentLens Python SDK — observability and audit trail for AI agents."""

__version__ = "0.3.0"

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
