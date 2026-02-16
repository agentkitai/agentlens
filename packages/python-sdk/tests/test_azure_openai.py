"""Tests for Azure OpenAI metadata enhancement (S1.3).

Tests that the OpenAI integration correctly detects Azure clients and
extracts deployment_name, api_version, and region metadata.
"""

from __future__ import annotations

import contextlib
import json
from unittest.mock import MagicMock, patch

import httpx
import pytest
import respx

from agentlensai import init, shutdown
from agentlensai._sender import reset_sender
from agentlensai._state import clear_state
from agentlensai.integrations.openai import _build_call_data, _detect_azure

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clean_state():
    yield
    with contextlib.suppress(Exception):
        shutdown()
    clear_state()
    reset_sender()
    try:
        from agentlensai.integrations.openai import uninstrument_openai

        uninstrument_openai()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_azure_client(
    base_url: str = "https://myresource.openai.azure.com/openai/deployments/gpt-4o/",
    azure_deployment: str | None = "gpt-4o-deploy",
    api_version: str | None = "2024-02-01",
) -> MagicMock:
    """Create a mock client that looks like AzureOpenAI."""
    client = MagicMock()
    client.base_url = base_url
    if azure_deployment:
        client._azure_deployment = azure_deployment  # real string
    else:
        client._azure_deployment = None
    if api_version:
        client._api_version = api_version
    else:
        client._api_version = None
    # No further parent
    client._client = None
    return client


def _make_regular_client() -> MagicMock:
    """Create a mock client that looks like regular OpenAI."""
    client = MagicMock()
    client.base_url = "https://api.openai.com/v1/"
    client._azure_deployment = None
    client._client = None
    return client


def _make_sdk_self(client: MagicMock) -> MagicMock:
    """Create a mock self_sdk (sub-resource) that walks up to the client."""
    # Simulate: self_sdk._client._client = client (the root)
    sub = MagicMock()
    sub._client = client
    return sub


def _mock_response(
    content: str = "Hello!",
    model: str = "gpt-4o",
    prompt_tokens: int = 10,
    completion_tokens: int = 5,
    total_tokens: int = 15,
) -> MagicMock:
    resp = MagicMock()
    choice = MagicMock()
    choice.message.content = content
    choice.message.tool_calls = None
    choice.finish_reason = "stop"
    resp.choices = [choice]
    resp.usage.prompt_tokens = prompt_tokens
    resp.usage.completion_tokens = completion_tokens
    resp.usage.total_tokens = total_tokens
    resp.model = model
    return resp


# ===================================================================
# Azure detection unit tests
# ===================================================================


class TestAzureDetection:
    """Test _detect_azure helper."""

    def test_detects_azure_by_deployment(self) -> None:
        client = _make_azure_client()
        is_azure, meta = _detect_azure(client)
        assert is_azure is True
        assert meta["deployment_name"] == "gpt-4o-deploy"

    def test_detects_azure_by_url(self) -> None:
        client = MagicMock()
        client.base_url = "https://eastus.openai.azure.com/openai/"
        client._azure_deployment = None
        client._api_version = "2024-02-01"
        client._client = None

        is_azure, meta = _detect_azure(client)
        assert is_azure is True
        assert meta["region"] == "eastus"

    def test_regular_openai_not_detected(self) -> None:
        client = _make_regular_client()
        is_azure, meta = _detect_azure(client)
        assert is_azure is False
        assert meta == {}

    def test_extracts_api_version(self) -> None:
        client = _make_azure_client(api_version="2024-06-01")
        is_azure, meta = _detect_azure(client)
        assert is_azure is True
        assert meta["api_version"] == "2024-06-01"

    def test_extracts_region_from_url(self) -> None:
        client = _make_azure_client(
            base_url="https://westeurope.openai.azure.com/openai/deployments/my-deploy/"
        )
        is_azure, meta = _detect_azure(client)
        assert meta["region"] == "westeurope"

    def test_walks_up_client_chain(self) -> None:
        """self_sdk._client points to the actual client."""
        root = _make_azure_client()
        sub = _make_sdk_self(root)
        is_azure, meta = _detect_azure(sub)
        assert is_azure is True
        assert meta["deployment_name"] == "gpt-4o-deploy"


# ===================================================================
# Integration tests — Azure metadata in events
# ===================================================================


class TestAzureOpenAIIntegration:
    """Test Azure metadata flows through to events."""

    @respx.mock
    def test_azure_provider_set(self) -> None:
        """Azure client → provider='azure_openai' in events."""
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        init("http://localhost:3400", session_id="az1", sync_mode=True)

        mock_resp = _mock_response()
        azure_client = _make_azure_client()
        sdk_self = _make_sdk_self(azure_client)

        from agentlensai.integrations import openai as oai_mod

        with patch.object(oai_mod, "_original_create", return_value=mock_resp):
            import openai.resources.chat.completions as cmod

            # Manually call the patched method with our azure mock as self
            result = cmod.Completions.create(
                sdk_self,
                model="gpt-4o",
                messages=[{"role": "user", "content": "Hello"}],
            )

        assert result is mock_resp
        body = json.loads(respx.calls[0].request.content)
        assert body["events"][0]["payload"]["provider"] == "azure_openai"
        assert body["events"][1]["payload"]["provider"] == "azure_openai"

    @respx.mock
    def test_azure_metadata_in_params(self) -> None:
        """Azure metadata (deployment, api_version, region) in parameters."""
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        init("http://localhost:3400", session_id="az2", sync_mode=True)

        mock_resp = _mock_response()
        azure_client = _make_azure_client(
            base_url="https://eastus2.openai.azure.com/openai/deployments/my-deploy/",
            azure_deployment="my-deploy",
            api_version="2024-02-01",
        )
        sdk_self = _make_sdk_self(azure_client)

        from agentlensai.integrations import openai as oai_mod

        with patch.object(oai_mod, "_original_create", return_value=mock_resp):
            import openai.resources.chat.completions as cmod

            cmod.Completions.create(
                sdk_self,
                model="gpt-4o",
                messages=[{"role": "user", "content": "Hello"}],
            )

        body = json.loads(respx.calls[0].request.content)
        params = body["events"][0]["payload"].get("parameters", {})
        azure = params.get("azure", {})
        assert azure["deployment_name"] == "my-deploy"
        assert azure["api_version"] == "2024-02-01"
        assert azure["region"] == "eastus2"

    @respx.mock
    def test_regular_openai_unchanged(self) -> None:
        """Non-Azure OpenAI client → provider='openai', no azure metadata."""
        respx.post("http://localhost:3400/api/events").mock(
            return_value=httpx.Response(200, json={"processed": 2})
        )
        init("http://localhost:3400", session_id="az3", sync_mode=True)

        mock_resp = _mock_response()
        regular_client = _make_regular_client()
        sdk_self = _make_sdk_self(regular_client)

        from agentlensai.integrations import openai as oai_mod

        with patch.object(oai_mod, "_original_create", return_value=mock_resp):
            import openai.resources.chat.completions as cmod

            cmod.Completions.create(
                sdk_self,
                model="gpt-4o",
                messages=[{"role": "user", "content": "Hello"}],
            )

        body = json.loads(respx.calls[0].request.content)
        assert body["events"][0]["payload"]["provider"] == "openai"
        params = body["events"][0]["payload"].get("parameters")
        if params:
            assert "azure" not in params

    @respx.mock
    def test_build_call_data_without_self_sdk(self) -> None:
        """_build_call_data with no self_sdk defaults to openai provider."""
        resp = _mock_response()
        data = _build_call_data(resp, "gpt-4o", [{"role": "user", "content": "hi"}], None, 100.0)
        assert data.provider == "openai"

    def test_azure_detection_failure_graceful(self) -> None:
        """If Azure detection throws, falls back to openai provider."""
        resp = _mock_response()

        # Create a self_sdk where _detect_azure will raise
        broken_sdk = MagicMock()
        # Make _client access raise
        type(broken_sdk)._client = property(lambda s: (_ for _ in ()).throw(RuntimeError("boom")))

        data = _build_call_data(resp, "gpt-4o", [], None, 100.0, self_sdk=broken_sdk)
        assert data.provider == "openai"

    def test_build_call_data_azure_sets_provider(self) -> None:
        """Direct unit test: _build_call_data with Azure self_sdk."""
        resp = _mock_response()
        azure_client = _make_azure_client()

        data = _build_call_data(resp, "gpt-4o", [], None, 100.0, self_sdk=azure_client)
        assert data.provider == "azure_openai"
        assert data.parameters is not None
        assert "azure" in data.parameters
        assert data.parameters["azure"]["deployment_name"] == "gpt-4o-deploy"
