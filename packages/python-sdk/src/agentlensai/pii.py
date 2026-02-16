"""PII filtering constants and utilities for AgentLens."""

from __future__ import annotations

import re
from typing import Any, Callable

# Built-in PII patterns
PII_EMAIL = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
PII_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
PII_CREDIT_CARD = re.compile(r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b")
PII_PHONE = re.compile(r"\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b")


def apply_pii_filters(
    value: Any,
    patterns: list[re.Pattern[str]] | None = None,
    pii_filter: Callable[[str], str] | None = None,
) -> Any:
    """Recursively apply PII filtering to a value (deep copy, no mutation).

    Handles str, dict, list, and nested combinations.
    """
    if isinstance(value, str):
        result = value
        if patterns:
            for pattern in patterns:
                result = pattern.sub("[REDACTED]", result)
        if pii_filter:
            result = pii_filter(result)
        return result
    if isinstance(value, dict):
        return {k: apply_pii_filters(v, patterns, pii_filter) for k, v in value.items()}
    if isinstance(value, list):
        return [apply_pii_filters(item, patterns, pii_filter) for item in value]
    return value
