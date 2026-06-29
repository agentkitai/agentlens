"""Centralized model→pricing lookup for LLM providers.

Provides ``get_cost(provider, model, input_tokens, output_tokens)`` for
providers that don't have built-in cost calculation.

- OpenAI / Anthropic: handled by their own integrations
- LiteLLM: uses ``litellm.completion_cost()``
- Ollama: always $0 (local)
- Bedrock, Vertex, Mistral, Cohere: use this module's lookup tables
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger("agentlensai")

# Strips a trailing date alias so e.g. gpt-4o-2024-08-06 → gpt-4o (#123).
_DATE_SUFFIX = re.compile(r"[-@]\d{4}[-_]\d{2}[-_]\d{2}$")

# Pricing per 1M tokens: (input_cost_per_1M, output_cost_per_1M)
# Sources: provider pricing pages as of 2026-02
_PRICING: dict[str, dict[str, tuple[float, float]]] = {
    "bedrock": {
        "anthropic.claude-3-5-sonnet-20241022-v2:0": (3.0, 15.0),
        "anthropic.claude-3-haiku-20240307-v1:0": (0.25, 1.25),
        "anthropic.claude-3-opus-20240229-v1:0": (15.0, 75.0),
        "anthropic.claude-3-sonnet-20240229-v1:0": (3.0, 15.0),
        "amazon.titan-text-express-v1": (0.2, 0.6),
        "amazon.titan-text-lite-v1": (0.15, 0.2),
        "meta.llama3-8b-instruct-v1:0": (0.3, 0.6),
        "meta.llama3-70b-instruct-v1:0": (2.65, 3.5),
        "mistral.mistral-7b-instruct-v0:2": (0.15, 0.2),
        "mistral.mixtral-8x7b-instruct-v0:1": (0.45, 0.7),
        "cohere.command-r-v1:0": (0.5, 1.5),
        "cohere.command-r-plus-v1:0": (3.0, 15.0),
    },
    "vertex": {
        "gemini-1.5-pro": (3.5, 10.5),
        "gemini-1.5-flash": (0.075, 0.3),
        "gemini-1.0-pro": (0.5, 1.5),
        "gemini-2.0-flash": (0.1, 0.4),
        "claude-3-5-sonnet@20241022": (3.0, 15.0),
        "claude-3-haiku@20240307": (0.25, 1.25),
        "claude-3-opus@20240229": (15.0, 75.0),
    },
    "mistral": {
        "mistral-tiny": (0.25, 0.25),
        "mistral-small": (1.0, 3.0),
        "mistral-small-latest": (1.0, 3.0),
        "mistral-medium": (2.7, 8.1),
        "mistral-medium-latest": (2.7, 8.1),
        "mistral-large-latest": (4.0, 12.0),
        "open-mistral-7b": (0.25, 0.25),
        "open-mixtral-8x7b": (0.7, 0.7),
        "open-mixtral-8x22b": (2.0, 6.0),
        "codestral-latest": (1.0, 3.0),
    },
    "cohere": {
        "command-r": (0.5, 1.5),
        "command-r-plus": (3.0, 15.0),
        "command-light": (0.3, 0.6),
        "command": (1.0, 2.0),
        "command-nightly": (1.0, 2.0),
    },
    # OpenAI / Anthropic capture-time cost (#123) — base names; dated aliases are
    # matched by stripping the date suffix (see cost_for).
    "openai": {
        "gpt-4o": (2.5, 10.0),
        "gpt-4o-mini": (0.15, 0.6),
        "gpt-4.1": (2.0, 8.0),
        "gpt-4.1-mini": (0.4, 1.6),
        "gpt-4.1-nano": (0.1, 0.4),
        "gpt-4-turbo": (10.0, 30.0),
        "gpt-4": (30.0, 60.0),
        "gpt-3.5-turbo": (0.5, 1.5),
        "o1": (15.0, 60.0),
        "o1-mini": (1.1, 4.4),
        "o3": (2.0, 8.0),
        "o3-mini": (1.1, 4.4),
        "o4-mini": (1.1, 4.4),
    },
    "anthropic": {
        "claude-3-5-sonnet-20241022": (3.0, 15.0),
        "claude-3-5-sonnet-20240620": (3.0, 15.0),
        "claude-3-5-sonnet-latest": (3.0, 15.0),
        "claude-3-5-haiku-20241022": (0.8, 4.0),
        "claude-3-5-haiku-latest": (0.8, 4.0),
        "claude-3-opus-20240229": (15.0, 75.0),
        "claude-3-opus-latest": (15.0, 75.0),
        "claude-3-sonnet-20240229": (3.0, 15.0),
        "claude-3-haiku-20240307": (0.25, 1.25),
        "claude-sonnet-4-20250514": (3.0, 15.0),
        "claude-opus-4-20250514": (15.0, 75.0),
        "claude-haiku-4-5": (0.8, 4.0),
    },
}


def get_cost(
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
) -> float | None:
    """Calculate cost in USD for a given provider/model/token count.

    Returns ``None`` if the model is not in the pricing table (with a
    logged warning).  Ollama always returns 0.0.  LiteLLM, OpenAI, and
    Anthropic should use their own built-in cost calculation instead.
    """
    if provider == "ollama":
        return 0.0

    provider_pricing = _PRICING.get(provider)
    if provider_pricing is None:
        logger.warning("AgentLens pricing: unknown provider '%s'", provider)
        return None

    pricing = provider_pricing.get(model)
    if pricing is None:
        logger.warning("AgentLens pricing: unknown model '%s' for provider '%s'", model, provider)
        return None

    input_cost_per_1m, output_cost_per_1m = pricing
    cost = (input_tokens * input_cost_per_1m + output_tokens * output_cost_per_1m) / 1_000_000
    return cost


def cost_for(provider: str, model: str, input_tokens: int, output_tokens: int) -> float:
    """Lenient capture-time cost for provider integrations (#123).

    Tries an exact model match, then a date-suffix-stripped alias
    (``gpt-4o-2024-08-06`` → ``gpt-4o``). Returns ``0.0`` when unknown (never
    ``None``) so per-call cost is always populated rather than dropped.
    """
    if provider == "ollama":
        return 0.0
    table = _PRICING.get(provider)
    if table is None:
        return 0.0
    pricing = table.get(model) or table.get(_DATE_SUFFIX.sub("", model))
    if pricing is None:
        logger.debug("AgentLens pricing: no entry for %s/%s", provider, model)
        return 0.0
    input_cost_per_1m, output_cost_per_1m = pricing
    return (input_tokens * input_cost_per_1m + output_tokens * output_cost_per_1m) / 1_000_000
