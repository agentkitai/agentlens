"""Tests for PII filtering hooks (S6)."""
from __future__ import annotations

import re
from unittest.mock import MagicMock, patch

import pytest

from agentlensai.pii import (
    PII_CREDIT_CARD,
    PII_EMAIL,
    PII_PHONE,
    PII_SSN,
    apply_pii_filters,
)
from agentlensai._sender import EventSender, LlmCallData
from agentlensai._state import InstrumentationState


# ─── Pattern unit tests ─────────────────────────────────────────────────────


class TestPIIPatterns:
    def test_email_pattern(self):
        text = "Contact me at john@example.com for details"
        assert PII_EMAIL.sub("[REDACTED]", text) == "Contact me at [REDACTED] for details"

    def test_ssn_pattern(self):
        text = "SSN: 123-45-6789"
        assert PII_SSN.sub("[REDACTED]", text) == "SSN: [REDACTED]"

    def test_credit_card_pattern(self):
        for cc in ["4111111111111111", "4111-1111-1111-1111", "4111 1111 1111 1111"]:
            assert PII_CREDIT_CARD.sub("[REDACTED]", f"Card: {cc}") == "Card: [REDACTED]"

    def test_phone_pattern(self):
        for phone in ["555-123-4567", "(555) 123-4567", "+1-555-123-4567", "5551234567"]:
            result = PII_PHONE.sub("[REDACTED]", f"Call {phone}")
            assert "[REDACTED]" in result, f"Failed to match: {phone}"

    def test_no_false_positives_ssn(self):
        text = "Order 12345"
        assert PII_SSN.sub("[REDACTED]", text) == text


# ─── apply_pii_filters tests ────────────────────────────────────────────────


class TestApplyPIIFilters:
    def test_string(self):
        result = apply_pii_filters("email: a@b.com", patterns=[PII_EMAIL])
        assert result == "email: [REDACTED]"

    def test_dict(self):
        data = {"content": "SSN 123-45-6789", "role": "user"}
        result = apply_pii_filters(data, patterns=[PII_SSN])
        assert result["content"] == "SSN [REDACTED]"
        assert result["role"] == "user"

    def test_list(self):
        data = [{"content": "a@b.com"}, {"content": "safe"}]
        result = apply_pii_filters(data, patterns=[PII_EMAIL])
        assert result[0]["content"] == "[REDACTED]"
        assert result[1]["content"] == "safe"

    def test_no_mutation(self):
        original = {"content": "SSN 123-45-6789"}
        result = apply_pii_filters(original, patterns=[PII_SSN])
        assert original["content"] == "SSN 123-45-6789"
        assert result["content"] == "SSN [REDACTED]"

    def test_custom_filter(self):
        result = apply_pii_filters("hello world", pii_filter=lambda s: s.upper())
        assert result == "HELLO WORLD"

    def test_patterns_and_filter_combined(self):
        result = apply_pii_filters(
            "email: a@b.com is secret",
            patterns=[PII_EMAIL],
            pii_filter=lambda s: s.replace("secret", "***"),
        )
        assert result == "email: [REDACTED] is ***"

    def test_non_string_passthrough(self):
        assert apply_pii_filters(42, patterns=[PII_EMAIL]) == 42
        assert apply_pii_filters(None, patterns=[PII_EMAIL]) is None


# ─── Integration: _send_events with PII filtering ───────────────────────────


def _make_state(**kwargs) -> InstrumentationState:
    client = MagicMock()
    client._request = MagicMock()
    defaults = dict(client=client, agent_id="test", session_id="sess-1", redact=False)
    defaults.update(kwargs)
    return InstrumentationState(**defaults)


def _make_data(**kwargs) -> LlmCallData:
    defaults = dict(
        provider="openai",
        model="gpt-4",
        messages=[{"role": "user", "content": "My email is test@example.com"}],
        system_prompt="You are helpful. Contact admin@corp.com",
        completion="Sure! Your email is test@example.com",
        tool_calls=None,
        finish_reason="stop",
        input_tokens=10,
        output_tokens=5,
        total_tokens=15,
        cost_usd=0.001,
        latency_ms=100.0,
    )
    defaults.update(kwargs)
    return LlmCallData(**defaults)


class TestSendEventsWithPII:
    def test_pii_patterns_redact_in_events(self):
        state = _make_state(pii_patterns=[PII_EMAIL])
        data = _make_data()
        original_content = data.messages[0]["content"]

        sender = EventSender(sync_mode=True)
        sender._send_events(state, data)

        # Verify the POST was called
        call_args = state.client._request.call_args
        events = call_args[1]["json"]["events"]

        # llm_call event
        call_payload = events[0]["payload"]
        assert "test@example.com" not in call_payload["messages"][0]["content"]
        assert "[REDACTED]" in call_payload["messages"][0]["content"]
        assert "[REDACTED]" in call_payload["systemPrompt"]

        # llm_response event
        resp_payload = events[1]["payload"]
        assert "test@example.com" not in resp_payload["completion"]
        assert "[REDACTED]" in resp_payload["completion"]

        # Original data not mutated
        assert data.messages[0]["content"] == original_content

    def test_custom_pii_filter(self):
        state = _make_state(pii_filter=lambda s: s.replace("test@example.com", "***"))
        data = _make_data()

        sender = EventSender(sync_mode=True)
        sender._send_events(state, data)

        events = state.client._request.call_args[1]["json"]["events"]
        assert "***" in events[0]["payload"]["messages"][0]["content"]
        assert "***" in events[1]["payload"]["completion"]

    def test_redact_true_still_works_independently(self):
        state = _make_state(redact=True)
        data = _make_data()

        sender = EventSender(sync_mode=True)
        sender._send_events(state, data)

        events = state.client._request.call_args[1]["json"]["events"]
        call_payload = events[0]["payload"]
        assert call_payload["messages"][0]["content"] == "[REDACTED]"
        assert call_payload["systemPrompt"] == "[REDACTED]"
        assert call_payload["redacted"] is True

    def test_redact_true_overrides_pii(self):
        """When redact=True, content is fully redacted regardless of PII patterns."""
        state = _make_state(redact=True, pii_patterns=[PII_EMAIL])
        data = _make_data()

        sender = EventSender(sync_mode=True)
        sender._send_events(state, data)

        events = state.client._request.call_args[1]["json"]["events"]
        # Full redaction, not pattern-based
        assert events[0]["payload"]["messages"][0]["content"] == "[REDACTED]"

    def test_no_mutation_of_original_data(self):
        state = _make_state(pii_patterns=[PII_EMAIL, PII_SSN])
        data = _make_data(
            messages=[{"role": "user", "content": "SSN 123-45-6789 email a@b.com"}],
            completion="Your SSN is 123-45-6789",
            system_prompt="Handle PII for a@b.com",
        )
        orig_msg = data.messages[0]["content"]
        orig_completion = data.completion
        orig_sys = data.system_prompt

        sender = EventSender(sync_mode=True)
        sender._send_events(state, data)

        assert data.messages[0]["content"] == orig_msg
        assert data.completion == orig_completion
        assert data.system_prompt == orig_sys

    def test_all_builtin_patterns(self):
        state = _make_state(pii_patterns=[PII_EMAIL, PII_SSN, PII_CREDIT_CARD, PII_PHONE])
        text = "email: a@b.com SSN: 123-45-6789 CC: 4111111111111111 phone: 555-123-4567"
        data = _make_data(
            messages=[{"role": "user", "content": text}],
            completion=text,
            system_prompt=None,
        )

        sender = EventSender(sync_mode=True)
        sender._send_events(state, data)

        events = state.client._request.call_args[1]["json"]["events"]
        msg_content = events[0]["payload"]["messages"][0]["content"]
        assert "a@b.com" not in msg_content
        assert "123-45-6789" not in msg_content
        assert "4111111111111111" not in msg_content
        assert "555-123-4567" not in msg_content
        assert msg_content.count("[REDACTED]") >= 4
