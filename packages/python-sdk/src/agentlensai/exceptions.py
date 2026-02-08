"""Custom exceptions for the AgentLens SDK."""

from __future__ import annotations

from typing import Any


class AgentLensError(Exception):
    """Base exception for AgentLens SDK errors."""

    def __init__(
        self,
        message: str,
        status: int = 0,
        code: str = "API_ERROR",
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details


class AuthenticationError(AgentLensError):
    """Raised on 401 Unauthorized."""

    def __init__(self, message: str = "Authentication failed") -> None:
        super().__init__(message, status=401, code="AUTHENTICATION_ERROR")


class NotFoundError(AgentLensError):
    """Raised on 404 Not Found."""

    def __init__(self, message: str = "Resource not found") -> None:
        super().__init__(message, status=404, code="NOT_FOUND")


class ValidationError(AgentLensError):
    """Raised on 400 Bad Request."""

    def __init__(self, message: str, details: Any = None) -> None:
        super().__init__(message, status=400, code="VALIDATION_ERROR", details=details)


class AgentLensConnectionError(AgentLensError):
    """Raised when the server is unreachable."""

    def __init__(self, message: str, cause: BaseException | None = None) -> None:
        super().__init__(message, status=0, code="CONNECTION_ERROR", details=cause)
        self.__cause__ = cause
