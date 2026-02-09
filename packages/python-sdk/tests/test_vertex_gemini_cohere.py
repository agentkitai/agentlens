"""Tests for Vertex AI (S3.1), Gemini (S3.2), and Cohere (S3.3) integrations."""
from __future__ import annotations

import asyncio
import sys
import types
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from agentlensai._sender import LlmCallData
from agentlensai.integrations.base_llm import BaseLLMInstrumentation


# ---------------------------------------------------------------------------
# Mock SDKs — create fake modules so imports work
# ---------------------------------------------------------------------------

def _setup_vertex_mock():
    """Set up mock google.cloud.aiplatform.generative_models module."""
    # Build nested module path
    google = types.ModuleType("google")
    google.cloud = types.ModuleType("google.cloud")  # type: ignore[attr-defined]
    google.cloud.aiplatform = types.ModuleType("google.cloud.aiplatform")  # type: ignore[attr-defined]
    gen_mod = types.ModuleType("google.cloud.aiplatform.generative_models")

    class _Part:
        def __init__(self, text: str):
            self.text = text

    class _Content:
        def __init__(self, parts: list):
            self.parts = parts

    class _Candidate:
        def __init__(self, content: _Content):
            self.content = content

    class _UsageMeta:
        def __init__(self, prompt: int = 10, candidates: int = 20, total: int = 30):
            self.prompt_token_count = prompt
            self.candidates_token_count = candidates
            self.total_token_count = total

    class _Response:
        def __init__(self, text: str = "Hello from Vertex"):
            self.candidates = [_Candidate(_Content([_Part(text)]))]
            self.usage_metadata = _UsageMeta()

    class GenerativeModel:
        def __init__(self, model_name: str = "gemini-1.5-pro"):
            self.model_name = model_name

        def generate_content(self, contents=None, **kwargs):
            return _Response()

        async def generate_content_async(self, contents=None, **kwargs):
            return _Response("Hello async from Vertex")

    gen_mod.GenerativeModel = GenerativeModel  # type: ignore[attr-defined]
    gen_mod._Response = _Response  # type: ignore[attr-defined]
    google.cloud.aiplatform.generative_models = gen_mod  # type: ignore[attr-defined]

    sys.modules["google"] = google
    sys.modules["google.cloud"] = google.cloud  # type: ignore[arg-type]
    sys.modules["google.cloud.aiplatform"] = google.cloud.aiplatform  # type: ignore[arg-type]
    sys.modules["google.cloud.aiplatform.generative_models"] = gen_mod

    return GenerativeModel, _Response


def _setup_gemini_mock():
    """Set up mock google.generativeai module."""
    google = sys.modules.get("google") or types.ModuleType("google")
    genai = types.ModuleType("google.generativeai")

    class _Part:
        def __init__(self, text: str):
            self.text = text

    class _Content:
        def __init__(self, parts: list):
            self.parts = parts

    class _Candidate:
        def __init__(self, content: _Content):
            self.content = content

    class _UsageMeta:
        def __init__(self, prompt: int = 5, candidates: int = 15, total: int = 20):
            self.prompt_token_count = prompt
            self.candidates_token_count = candidates
            self.total_token_count = total

    class _Response:
        def __init__(self, text: str = "Hello from Gemini"):
            self.candidates = [_Candidate(_Content([_Part(text)]))]
            self.usage_metadata = _UsageMeta()

    class GenerativeModel:
        def __init__(self, model_name: str = "gemini-1.5-flash"):
            self.model_name = model_name

        def generate_content(self, contents=None, **kwargs):
            return _Response()

        async def generate_content_async(self, contents=None, **kwargs):
            return _Response("Hello async from Gemini")

    genai.GenerativeModel = GenerativeModel  # type: ignore[attr-defined]
    genai._Response = _Response  # type: ignore[attr-defined]
    google.generativeai = genai  # type: ignore[attr-defined]

    sys.modules["google"] = google
    sys.modules["google.generativeai"] = genai

    return GenerativeModel, _Response


def _setup_cohere_mock():
    """Set up mock cohere module."""
    cohere_mod = types.ModuleType("cohere")

    class _ContentItem:
        def __init__(self, text: str):
            self.text = text

    class _Message:
        def __init__(self, content: list):
            self.content = content

    class _Tokens:
        def __init__(self, input_tokens: int = 10, output_tokens: int = 20):
            self.input_tokens = input_tokens
            self.output_tokens = output_tokens

    class _Usage:
        def __init__(self):
            self.tokens = _Tokens()

    class _V2Response:
        def __init__(self, text: str = "Hello from Cohere v2"):
            self.message = _Message([_ContentItem(text)])
            self.usage = _Usage()

    class _V1Tokens:
        def __init__(self, input_tokens: int = 8, output_tokens: int = 12):
            self.input_tokens = input_tokens
            self.output_tokens = output_tokens

    class _V1Meta:
        def __init__(self):
            self.tokens = _V1Tokens()

    class _V1Response:
        def __init__(self, text: str = "Hello from Cohere v1"):
            self.text = text
            self.meta = _V1Meta()

    class _Generation:
        def __init__(self, text: str):
            self.text = text

    class _GenerateResponse:
        def __init__(self, text: str = "Hello generated"):
            self.generations = [_Generation(text)]
            self.meta = _V1Meta()

    class ClientV2:
        def chat(self, **kwargs):
            return _V2Response()

    class Client:
        def chat(self, **kwargs):
            return _V1Response()

        def generate(self, **kwargs):
            return _GenerateResponse()

    cohere_mod.ClientV2 = ClientV2  # type: ignore[attr-defined]
    cohere_mod.Client = Client  # type: ignore[attr-defined]
    cohere_mod._V2Response = _V2Response  # type: ignore[attr-defined]
    cohere_mod._V1Response = _V1Response  # type: ignore[attr-defined]
    cohere_mod._GenerateResponse = _GenerateResponse  # type: ignore[attr-defined]

    sys.modules["cohere"] = cohere_mod

    return ClientV2, Client, _V2Response, _V1Response, _GenerateResponse


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

VertexModel, VertexResponse = _setup_vertex_mock()
GeminiModel, GeminiResponse = _setup_gemini_mock()
CohereV2, CohereV1, V2Resp, V1Resp, GenResp = _setup_cohere_mock()

# Now import the integrations (they register via @register)
from agentlensai.integrations.vertex import VertexInstrumentation
from agentlensai.integrations.gemini import GeminiInstrumentation
from agentlensai.integrations.cohere import CohereInstrumentation


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_state():
    from agentlensai._state import InstrumentationState
    client_mock = MagicMock()
    return InstrumentationState(client=client_mock, agent_id="test", session_id="sess")


def _with_state(fn):
    """Run fn with agentlens state set, then clear."""
    from agentlensai._state import clear_state, set_state
    state = _make_state()
    set_state(state)
    try:
        return fn()
    finally:
        clear_state()


# ---------------------------------------------------------------------------
# S3.1 — Vertex AI Tests
# ---------------------------------------------------------------------------


class TestVertexInstrumentation:

    def setup_method(self):
        # Reset generate_content to original
        VertexModel.generate_content = lambda self, contents=None, **kw: VertexResponse()

        async def _async_gen(self, contents=None, **kw):
            return VertexResponse("Hello async from Vertex")
        VertexModel.generate_content_async = _async_gen

    def test_inherits_base(self):
        assert issubclass(VertexInstrumentation, BaseLLMInstrumentation)

    def test_registered(self):
        from agentlensai.integrations.registry import REGISTRY
        assert "vertex" in REGISTRY

    def test_instrument_patches(self):
        inst = VertexInstrumentation()
        original = VertexModel.generate_content
        inst.instrument()
        assert VertexModel.generate_content is not original
        inst.uninstrument()

    def test_sync_capture(self):
        inst = VertexInstrumentation()
        inst.instrument()
        try:
            def run():
                model = VertexModel("gemini-1.5-pro")
                with patch("agentlensai._sender.get_sender") as mock_sender:
                    mock_send = MagicMock()
                    mock_sender.return_value.send = mock_send
                    result = model.generate_content(contents="Hello")
                    assert result.candidates[0].content.parts[0].text == "Hello from Vertex"
                    assert mock_send.called
                    data = mock_send.call_args[0][1]
                    assert data.provider == "vertex"
                    assert data.model == "gemini-1.5-pro"
                    assert data.input_tokens == 10
                    assert data.output_tokens == 20
            _with_state(run)
        finally:
            inst.uninstrument()

    def test_async_capture(self):
        inst = VertexInstrumentation()
        inst.instrument()
        try:
            def run():
                model = VertexModel("gemini-1.5-pro")
                with patch("agentlensai._sender.get_sender") as mock_sender:
                    mock_send = MagicMock()
                    mock_sender.return_value.send = mock_send
                    result = asyncio.get_event_loop().run_until_complete(
                        model.generate_content_async(contents="Hello async")
                    )
                    assert "async" in result.candidates[0].content.parts[0].text
                    assert mock_send.called
            _with_state(run)
        finally:
            inst.uninstrument()

    def test_streaming_passthrough(self):
        inst = VertexInstrumentation()
        inst.instrument()
        try:
            def run():
                model = VertexModel()
                with patch("agentlensai._sender.get_sender") as mock_sender:
                    mock_send = MagicMock()
                    mock_sender.return_value.send = mock_send
                    model.generate_content(contents="Hello", stream=True)
                    assert not mock_send.called
            _with_state(run)
        finally:
            inst.uninstrument()

    def test_no_state_passthrough(self):
        inst = VertexInstrumentation()
        inst.instrument()
        try:
            model = VertexModel()
            with patch("agentlensai._sender.get_sender") as mock_sender:
                mock_send = MagicMock()
                mock_sender.return_value.send = mock_send
                result = model.generate_content(contents="Hello")
                assert not mock_send.called
                assert result.candidates[0].content.parts[0].text == "Hello from Vertex"
        finally:
            inst.uninstrument()

    def test_uninstrument_restores(self):
        inst = VertexInstrumentation()
        original = VertexModel.generate_content
        inst.instrument()
        inst.uninstrument()
        # Should be restored (or functionally equivalent)
        assert not inst.is_instrumented


# ---------------------------------------------------------------------------
# S3.2 — Gemini Tests
# ---------------------------------------------------------------------------


class TestGeminiInstrumentation:

    def setup_method(self):
        GeminiModel.generate_content = lambda self, contents=None, **kw: GeminiResponse()

        async def _async_gen(self, contents=None, **kw):
            return GeminiResponse("Hello async from Gemini")
        GeminiModel.generate_content_async = _async_gen

    def test_inherits_base(self):
        assert issubclass(GeminiInstrumentation, BaseLLMInstrumentation)

    def test_registered(self):
        from agentlensai.integrations.registry import REGISTRY
        assert "gemini" in REGISTRY

    def test_instrument_patches(self):
        inst = GeminiInstrumentation()
        original = GeminiModel.generate_content
        inst.instrument()
        assert GeminiModel.generate_content is not original
        inst.uninstrument()

    def test_sync_capture(self):
        inst = GeminiInstrumentation()
        inst.instrument()
        try:
            def run():
                model = GeminiModel("gemini-1.5-flash")
                with patch("agentlensai._sender.get_sender") as mock_sender:
                    mock_send = MagicMock()
                    mock_sender.return_value.send = mock_send
                    result = model.generate_content(contents="Hello")
                    assert result.candidates[0].content.parts[0].text == "Hello from Gemini"
                    assert mock_send.called
                    data = mock_send.call_args[0][1]
                    assert data.provider == "gemini"
                    assert data.model == "gemini-1.5-flash"
                    assert data.input_tokens == 5
                    assert data.output_tokens == 15
            _with_state(run)
        finally:
            inst.uninstrument()

    def test_async_capture(self):
        inst = GeminiInstrumentation()
        inst.instrument()
        try:
            def run():
                model = GeminiModel("gemini-1.5-flash")
                with patch("agentlensai._sender.get_sender") as mock_sender:
                    mock_send = MagicMock()
                    mock_sender.return_value.send = mock_send
                    result = asyncio.get_event_loop().run_until_complete(
                        model.generate_content_async(contents="Hello")
                    )
                    assert mock_send.called
            _with_state(run)
        finally:
            inst.uninstrument()

    def test_streaming_passthrough(self):
        inst = GeminiInstrumentation()
        inst.instrument()
        try:
            def run():
                model = GeminiModel()
                with patch("agentlensai._sender.get_sender") as mock_sender:
                    mock_send = MagicMock()
                    mock_sender.return_value.send = mock_send
                    model.generate_content(contents="Hello", stream=True)
                    assert not mock_send.called
            _with_state(run)
        finally:
            inst.uninstrument()

    def test_no_state_passthrough(self):
        inst = GeminiInstrumentation()
        inst.instrument()
        try:
            model = GeminiModel()
            with patch("agentlensai._sender.get_sender") as mock_sender:
                mock_send = MagicMock()
                mock_sender.return_value.send = mock_send
                result = model.generate_content(contents="Hello")
                assert not mock_send.called
        finally:
            inst.uninstrument()

    def test_completion_extraction(self):
        inst = GeminiInstrumentation()
        inst.instrument()
        try:
            def run():
                model = GeminiModel("gemini-1.5-flash")
                with patch("agentlensai._sender.get_sender") as mock_sender:
                    mock_send = MagicMock()
                    mock_sender.return_value.send = mock_send
                    model.generate_content(contents="What is 2+2?")
                    data = mock_send.call_args[0][1]
                    assert data.completion == "Hello from Gemini"
                    assert data.total_tokens == 20
            _with_state(run)
        finally:
            inst.uninstrument()


# ---------------------------------------------------------------------------
# S3.3 — Cohere Tests
# ---------------------------------------------------------------------------


class TestCohereInstrumentation:

    def setup_method(self):
        CohereV2.chat = lambda self, **kw: V2Resp()
        CohereV1.chat = lambda self, **kw: V1Resp()
        CohereV1.generate = lambda self, **kw: GenResp()

    def test_inherits_base(self):
        assert issubclass(CohereInstrumentation, BaseLLMInstrumentation)

    def test_registered(self):
        from agentlensai.integrations.registry import REGISTRY
        assert "cohere" in REGISTRY

    def test_instrument_patches(self):
        inst = CohereInstrumentation()
        original_v2 = CohereV2.chat
        inst.instrument()
        assert CohereV2.chat is not original_v2
        inst.uninstrument()

    def test_v2_chat_capture(self):
        inst = CohereInstrumentation()
        inst.instrument()
        try:
            def run():
                client = CohereV2()
                with patch("agentlensai._sender.get_sender") as mock_sender:
                    mock_send = MagicMock()
                    mock_sender.return_value.send = mock_send
                    result = client.chat(model="command-r-plus", messages=[{"role": "user", "content": "Hi"}])
                    assert result.message.content[0].text == "Hello from Cohere v2"
                    assert mock_send.called
                    data = mock_send.call_args[0][1]
                    assert data.provider == "cohere"
                    assert data.model == "command-r-plus"
                    assert data.input_tokens == 10
                    assert data.output_tokens == 20
            _with_state(run)
        finally:
            inst.uninstrument()

    def test_v1_chat_capture(self):
        inst = CohereInstrumentation()
        inst.instrument()
        try:
            def run():
                client = CohereV1()
                with patch("agentlensai._sender.get_sender") as mock_sender:
                    mock_send = MagicMock()
                    mock_sender.return_value.send = mock_send
                    result = client.chat(model="command", message="Hello")
                    assert result.text == "Hello from Cohere v1"
                    assert mock_send.called
                    data = mock_send.call_args[0][1]
                    assert data.provider == "cohere"
                    assert data.input_tokens == 8
                    assert data.output_tokens == 12
            _with_state(run)
        finally:
            inst.uninstrument()

    def test_generate_capture(self):
        inst = CohereInstrumentation()
        inst.instrument()
        try:
            def run():
                client = CohereV1()
                with patch("agentlensai._sender.get_sender") as mock_sender:
                    mock_send = MagicMock()
                    mock_sender.return_value.send = mock_send
                    result = client.generate(model="command", prompt="Write a poem")
                    assert result.generations[0].text == "Hello generated"
                    assert mock_send.called
                    data = mock_send.call_args[0][1]
                    assert data.provider == "cohere"
            _with_state(run)
        finally:
            inst.uninstrument()

    def test_streaming_passthrough(self):
        inst = CohereInstrumentation()
        inst.instrument()
        try:
            def run():
                client = CohereV2()
                with patch("agentlensai._sender.get_sender") as mock_sender:
                    mock_send = MagicMock()
                    mock_sender.return_value.send = mock_send
                    client.chat(model="command", stream=True)
                    assert not mock_send.called
            _with_state(run)
        finally:
            inst.uninstrument()

    def test_no_state_passthrough(self):
        inst = CohereInstrumentation()
        inst.instrument()
        try:
            client = CohereV2()
            with patch("agentlensai._sender.get_sender") as mock_sender:
                mock_send = MagicMock()
                mock_sender.return_value.send = mock_send
                result = client.chat(model="command")
                assert not mock_send.called
        finally:
            inst.uninstrument()

    def test_uninstrument_restores(self):
        inst = CohereInstrumentation()
        inst.instrument()
        inst.uninstrument()
        assert not inst.is_instrumented

    def test_v2_messages_extraction(self):
        inst = CohereInstrumentation()
        inst.instrument()
        try:
            def run():
                client = CohereV2()
                with patch("agentlensai._sender.get_sender") as mock_sender:
                    mock_send = MagicMock()
                    mock_sender.return_value.send = mock_send
                    client.chat(
                        model="command-r-plus",
                        messages=[
                            {"role": "system", "content": "You are helpful"},
                            {"role": "user", "content": "Hi"},
                        ],
                    )
                    data = mock_send.call_args[0][1]
                    assert len(data.messages) == 2
                    assert data.messages[0]["role"] == "system"
            _with_state(run)
        finally:
            inst.uninstrument()
