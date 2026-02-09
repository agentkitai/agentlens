"""Tests for AWS Bedrock instrumentation (S2.1 + S2.2).

All boto3/botocore dependencies are mocked — no AWS credentials needed.
"""
from __future__ import annotations

import io
import json
import sys
import types
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from agentlensai._sender import LlmCallData


# ---------------------------------------------------------------------------
# Mock botocore module hierarchy before importing bedrock integration
# ---------------------------------------------------------------------------

def _setup_botocore_mocks():
    """Create mock botocore modules in sys.modules."""
    botocore_mod = types.ModuleType("botocore")
    botocore_client_mod = types.ModuleType("botocore.client")

    class MockBaseClient:
        def __init__(self, *args, **kwargs):
            self._service_model = MagicMock()
            self._service_model.service_name = "s3"  # default non-bedrock

    class MockClientCreator:
        def create_client(self, *args, **kwargs):
            return MockBaseClient()

    botocore_client_mod.BaseClient = MockBaseClient  # type: ignore
    botocore_client_mod.ClientCreator = MockClientCreator  # type: ignore
    botocore_mod.client = botocore_client_mod  # type: ignore

    sys.modules["botocore"] = botocore_mod
    sys.modules["botocore.client"] = botocore_client_mod

    return botocore_client_mod, MockBaseClient


_botocore_client_mod, _MockBaseClient = _setup_botocore_mocks()


from agentlensai.integrations.bedrock import (
    BedrockInstrumentation,
    _detect_model_family,
    _parse_converse_response,
    _parse_invoke_response,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_instrumentation():
    """Ensure each test starts clean."""
    yield
    # Clean up: restore BaseClient.__init__ if it was patched
    try:
        inst = BedrockInstrumentation()
        inst.uninstrument()
    except Exception:
        pass


@pytest.fixture
def mock_state():
    state = MagicMock()
    state.session_id = "test-session"
    return state


@pytest.fixture
def mock_sender():
    sender = MagicMock()
    return sender


# ---------------------------------------------------------------------------
# S2.1: Model family detection
# ---------------------------------------------------------------------------

class TestModelFamilyDetection:
    def test_anthropic_family(self):
        assert _detect_model_family("anthropic.claude-3-sonnet-20240229-v1:0") == "anthropic"

    def test_titan_family(self):
        assert _detect_model_family("amazon.titan-text-express-v1") == "titan"

    def test_llama_family(self):
        assert _detect_model_family("meta.llama3-70b-instruct-v1:0") == "llama"

    def test_mistral_family(self):
        assert _detect_model_family("mistral.mistral-large-2402-v1:0") == "mistral"

    def test_unknown_family(self):
        assert _detect_model_family("some-random-model") == "unknown"


# ---------------------------------------------------------------------------
# S2.1: InvokeModel response parsing
# ---------------------------------------------------------------------------

class TestInvokeResponseParsing:
    def test_anthropic_response(self):
        body = {
            "content": [{"type": "text", "text": "Hello from Claude"}],
            "usage": {"input_tokens": 10, "output_tokens": 25},
        }
        result = _parse_invoke_response(body, "anthropic")
        assert result["content"] == "Hello from Claude"
        assert result["input_tokens"] == 10
        assert result["output_tokens"] == 25

    def test_titan_response(self):
        body = {
            "inputTextTokenCount": 15,
            "results": [{"outputText": "Hello from Titan", "tokenCount": 20}],
        }
        result = _parse_invoke_response(body, "titan")
        assert result["content"] == "Hello from Titan"
        assert result["input_tokens"] == 15
        assert result["output_tokens"] == 20

    def test_llama_response(self):
        body = {
            "generation": "Hello from Llama",
            "prompt_token_count": 12,
            "generation_token_count": 18,
        }
        result = _parse_invoke_response(body, "llama")
        assert result["content"] == "Hello from Llama"
        assert result["input_tokens"] == 12
        assert result["output_tokens"] == 18

    def test_unknown_family_response(self):
        body = {
            "completion": "Some output",
            "usage": {"input_tokens": 5, "output_tokens": 10},
        }
        result = _parse_invoke_response(body, "unknown")
        assert result["content"] == "Some output"
        assert result["input_tokens"] == 5
        assert result["output_tokens"] == 10


# ---------------------------------------------------------------------------
# S2.1: BedrockInstrumentation invoke_model integration
# ---------------------------------------------------------------------------

class TestBedrockInvokeModel:
    def test_instrument_uninstrument_idempotent(self):
        inst = BedrockInstrumentation()
        inst.instrument()
        assert inst.is_instrumented
        inst.instrument()  # second call is no-op
        assert inst.is_instrumented
        inst.uninstrument()
        assert not inst.is_instrumented
        inst.uninstrument()  # second call is no-op
        assert not inst.is_instrumented

    def test_invoke_model_captures_anthropic(self, mock_state, mock_sender):
        inst = BedrockInstrumentation()
        inst.instrument()

        # Create a mock bedrock-runtime client
        client = MagicMock()
        client._service_model.service_name = "bedrock-runtime"

        response_body = json.dumps({
            "content": [{"type": "text", "text": "Hello!"}],
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }).encode()

        original_invoke = MagicMock(return_value={
            "body": io.BytesIO(response_body),
            "ResponseMetadata": {},
        })
        client.invoke_model = original_invoke

        # Manually trigger client patching
        inst._patch_bedrock_client(client)

        with patch("agentlensai._state.get_state", return_value=mock_state), \
             patch("agentlensai._sender.get_sender", return_value=mock_sender):
            result = client.invoke_model(
                modelId="anthropic.claude-3-sonnet-20240229-v1:0",
                body=json.dumps({"messages": [{"role": "user", "content": "Hi"}]}),
            )

        assert mock_sender.send.called
        call_data = mock_sender.send.call_args[0][1]
        assert isinstance(call_data, LlmCallData)
        assert call_data.provider == "bedrock"
        assert call_data.model == "anthropic.claude-3-sonnet-20240229-v1:0"
        assert call_data.completion == "Hello!"
        assert call_data.input_tokens == 10
        assert call_data.output_tokens == 5

        inst.uninstrument()

    def test_invoke_model_passthrough_when_no_state(self, mock_sender):
        inst = BedrockInstrumentation()
        inst.instrument()

        client = MagicMock()
        client._service_model.service_name = "bedrock-runtime"

        response_body = json.dumps({"content": [{"text": "Hi"}], "usage": {}}).encode()
        original_invoke = MagicMock(return_value={"body": io.BytesIO(response_body)})
        client.invoke_model = original_invoke
        inst._patch_bedrock_client(client)

        with patch("agentlensai._state.get_state", return_value=None):
            client.invoke_model(modelId="anthropic.claude-3-sonnet", body="{}")

        assert not mock_sender.send.called
        inst.uninstrument()


# ---------------------------------------------------------------------------
# S2.2: Converse API
# ---------------------------------------------------------------------------

class TestConverseAPI:
    def test_parse_converse_response(self):
        response = {
            "output": {
                "message": {
                    "role": "assistant",
                    "content": [{"text": "Hello from Converse"}],
                }
            },
            "usage": {"inputTokens": 20, "outputTokens": 30},
            "stopReason": "end_turn",
        }
        result = _parse_converse_response(response)
        assert result["content"] == "Hello from Converse"
        assert result["input_tokens"] == 20
        assert result["output_tokens"] == 30

    def test_converse_captures_call(self, mock_state, mock_sender):
        inst = BedrockInstrumentation()
        inst.instrument()

        client = MagicMock()
        client._service_model.service_name = "bedrock-runtime"

        converse_response = {
            "output": {
                "message": {
                    "role": "assistant",
                    "content": [{"text": "Converse reply"}],
                }
            },
            "usage": {"inputTokens": 15, "outputTokens": 25},
            "stopReason": "end_turn",
        }
        original_converse = MagicMock(return_value=converse_response)
        client.converse = original_converse
        inst._patch_bedrock_client(client)

        with patch("agentlensai._state.get_state", return_value=mock_state), \
             patch("agentlensai._sender.get_sender", return_value=mock_sender):
            result = client.converse(
                modelId="anthropic.claude-3-sonnet-20240229-v1:0",
                messages=[{"role": "user", "content": [{"text": "Hello"}]}],
            )

        assert mock_sender.send.called
        call_data = mock_sender.send.call_args[0][1]
        assert call_data.provider == "bedrock"
        assert call_data.completion == "Converse reply"
        assert call_data.input_tokens == 15
        assert call_data.output_tokens == 25

        inst.uninstrument()

    def test_converse_passthrough_when_no_state(self, mock_sender):
        inst = BedrockInstrumentation()
        inst.instrument()

        client = MagicMock()
        client._service_model.service_name = "bedrock-runtime"
        original_converse = MagicMock(return_value={"output": {}, "usage": {}})
        client.converse = original_converse
        inst._patch_bedrock_client(client)

        with patch("agentlensai._state.get_state", return_value=None):
            client.converse(modelId="anthropic.claude-3-sonnet", messages=[])

        assert not mock_sender.send.called
        inst.uninstrument()

    def test_converse_extracts_messages_and_system(self, mock_state, mock_sender):
        inst = BedrockInstrumentation()
        inst.instrument()

        client = MagicMock()
        client._service_model.service_name = "bedrock-runtime"

        converse_response = {
            "output": {"message": {"role": "assistant", "content": [{"text": "OK"}]}},
            "usage": {"inputTokens": 10, "outputTokens": 5},
            "stopReason": "end_turn",
        }
        original_converse = MagicMock(return_value=converse_response)
        client.converse = original_converse
        inst._patch_bedrock_client(client)

        with patch("agentlensai._state.get_state", return_value=mock_state), \
             patch("agentlensai._sender.get_sender", return_value=mock_sender):
            client.converse(
                modelId="anthropic.claude-3-sonnet",
                messages=[{"role": "user", "content": [{"text": "Hi there"}]}],
                system=[{"text": "You are helpful"}],
            )

        call_data = mock_sender.send.call_args[0][1]
        assert call_data.system_prompt == "You are helpful"
        assert call_data.messages == [{"role": "user", "content": "Hi there"}]

        inst.uninstrument()


# ---------------------------------------------------------------------------
# S2.1: Registry integration
# ---------------------------------------------------------------------------

class TestBedrockRegistry:
    def test_registered_in_registry(self):
        from agentlensai.integrations.registry import REGISTRY
        assert "bedrock" in REGISTRY
        assert REGISTRY["bedrock"] is BedrockInstrumentation
