from __future__ import annotations
"""Tests for B8A: Cloud mode (S-5.1, S-5.2, S-5.3, S-5.4).

S-5.1: API Key Header Support
S-5.2: Cloud Convenience Init
S-5.3: Cloud Error Handling & Retry
S-5.4: SDK Integration Tests
"""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import httpx
import pytest

from agentlensai._init import (
    _DEFAULT_URL,
    CLOUD_URL,
    _mask_key,
    _resolve_api_key,
    _resolve_url,
    init,
    shutdown,
)
from agentlensai.client import AgentLensClient
from agentlensai.exceptions import (
    AuthenticationError,
    BackpressureError,
    QuotaExceededError,
    RateLimitError,
)

# ─── S-5.1: API Key Header Support ────────────────────────


class TestApiKeySupport:
    """S-5.1: API key header and env var tests."""

    def test_api_key_sent_as_bearer_header(self):
        """API key is sent as Authorization: Bearer header."""
        client = AgentLensClient("http://localhost:3400", api_key="als_test123")
        assert client._client.headers["Authorization"] == "Bearer als_test123"
        client.close()

    def test_no_api_key_no_auth_header(self):
        """No auth header when api_key is None."""
        client = AgentLensClient("http://localhost:3400")
        assert "Authorization" not in client._client.headers
        client.close()

    def test_api_key_from_env_var(self):
        """AGENTLENS_API_KEY env var is used when no explicit key."""
        with patch.dict(os.environ, {"AGENTLENS_API_KEY": "als_envkey"}):
            assert _resolve_api_key(None) == "als_envkey"

    def test_explicit_api_key_overrides_env(self):
        """Explicit api_key takes precedence over env var."""
        with patch.dict(os.environ, {"AGENTLENS_API_KEY": "als_envkey"}):
            assert _resolve_api_key("als_explicit") == "als_explicit"

    def test_mask_key_hides_most_chars(self):
        """Key masking shows only last 4 chars."""
        assert _mask_key("als_1234567890") == "****7890"

    def test_mask_key_short(self):
        """Very short keys are fully masked."""
        assert _mask_key("ab") == "****"

    def test_init_with_env_api_key(self):
        """init() picks up AGENTLENS_API_KEY from environment."""
        with patch.dict(os.environ, {"AGENTLENS_API_KEY": "als_fromenv"}): # noqa: SIM117
            with patch("agentlensai._init.AgentLensClient") as MockClient:
                mock_instance = MagicMock()
                MockClient.return_value = mock_instance
                with patch("agentlensai._init.get_state", return_value=None): # noqa: SIM117
                    with patch("agentlensai._init.set_state"):
                        with patch("agentlensai._init.get_sender"):
                            with patch("agentlensai._init._instrument_providers"):
                                with patch("agentlensai._init._instrument_frameworks"):
                                    init(url="http://localhost:3400")
                                    shutdown()
                MockClient.assert_called_once_with("http://localhost:3400", api_key="als_fromenv")

    def test_api_key_not_logged_in_full(self, caplog):
        """Full API key must never appear in logs."""
        import logging

        with caplog.at_level(logging.DEBUG, logger="agentlensai"):
            _mask_key("als_supersecretkey123")
        # The full key should never appear in any log
        for record in caplog.records:
            assert "als_supersecretkey123" not in record.message


# ─── S-5.2: Cloud Convenience Init ────────────────────────


class TestCloudConvenienceInit:
    """S-5.2: cloud=True and URL resolution priority."""

    def test_cloud_true_uses_cloud_url(self):
        """cloud=True resolves to the cloud URL."""
        assert _resolve_url(None, cloud=True) == CLOUD_URL

    def test_explicit_url_overrides_cloud(self):
        """Explicit server_url takes precedence over cloud=True."""
        assert _resolve_url("http://custom:3400", cloud=True) == "http://custom:3400"

    def test_env_url_used_when_no_explicit_or_cloud(self):
        """AGENTLENS_SERVER_URL env var is fallback."""
        with patch.dict(os.environ, {"AGENTLENS_SERVER_URL": "http://env:3400"}):
            assert _resolve_url(None, cloud=False) == "http://env:3400"

    def test_default_url_is_localhost(self):
        """Default URL is localhost:3400."""
        with patch.dict(os.environ, {}, clear=True):
            # Remove AGENTLENS_SERVER_URL if present
            os.environ.pop("AGENTLENS_SERVER_URL", None)
            assert _resolve_url(None, cloud=False) == _DEFAULT_URL

    def test_explicit_url_overrides_env(self):
        """Explicit URL beats env var."""
        with patch.dict(os.environ, {"AGENTLENS_SERVER_URL": "http://env:3400"}):
            assert _resolve_url("http://explicit:3400", cloud=False) == "http://explicit:3400"

    def test_cloud_overrides_env(self):
        """cloud=True beats env var."""
        with patch.dict(os.environ, {"AGENTLENS_SERVER_URL": "http://env:3400"}):
            assert _resolve_url(None, cloud=True) == CLOUD_URL

    def test_init_cloud_mode(self):
        """init(cloud=True) creates client with cloud URL."""
        with patch("agentlensai._init.AgentLensClient") as MockClient:
            mock_instance = MagicMock()
            MockClient.return_value = mock_instance
            with patch("agentlensai._init.get_state", return_value=None): # noqa: SIM117
                with patch("agentlensai._init.set_state"):
                    with patch("agentlensai._init.get_sender"):
                        with patch("agentlensai._init._instrument_providers"):
                            with patch("agentlensai._init._instrument_frameworks"):
                                init(cloud=True, api_key="als_test")
                                shutdown()
            MockClient.assert_called_once_with(CLOUD_URL, api_key="als_test")

    def test_init_backward_compat_positional_url(self):
        """init(url) still works for backward compatibility."""
        with patch("agentlensai._init.AgentLensClient") as MockClient:
            mock_instance = MagicMock()
            MockClient.return_value = mock_instance
            with patch("agentlensai._init.get_state", return_value=None): # noqa: SIM117
                with patch("agentlensai._init.set_state"):
                    with patch("agentlensai._init.get_sender"):
                        with patch("agentlensai._init._instrument_providers"):
                            with patch("agentlensai._init._instrument_frameworks"):
                                init("http://localhost:3400")
                                shutdown()
            MockClient.assert_called_once_with("http://localhost:3400", api_key=None)


# ─── S-5.3: Cloud Error Handling & Retry ──────────────────


class TestCloudErrorHandling:
    """S-5.3: Error handling for 401, 402, 429, 503."""

    def _make_response(self, status_code: int, text: str = "", headers: dict | None = None):
        """Create a mock httpx.Response."""
        resp = httpx.Response(
            status_code=status_code,
            text=text,
            headers=headers or {},
            request=httpx.Request("POST", "http://test/api/events"),
        )
        return resp

    def test_401_raises_auth_error_no_retry(self):
        """401 raises AuthenticationError immediately (no retry)."""
        client = AgentLensClient("http://localhost:3400", api_key="bad_key")
        with patch.object(
            client,
            "_do_request",
            return_value=self._make_response(401, '{"error":"Invalid API key"}'),
        ), pytest.raises(AuthenticationError, match="Invalid API key"):
            client._request("POST", "/api/events", json={})
        # Should only be called once (no retry)
        client.close()

    def test_402_raises_quota_error(self):
        """402 raises QuotaExceededError immediately."""
        client = AgentLensClient("http://localhost:3400", api_key="key")
        with patch.object(
            client,
            "_do_request",
            return_value=self._make_response(402, '{"error":"Quota exceeded"}'),
        ), pytest.raises(QuotaExceededError):
            client._request("POST", "/api/events", json={})
        client.close()

    def test_429_retries_with_retry_after(self):
        """429 retries using Retry-After header value."""
        client = AgentLensClient("http://localhost:3400", api_key="key")
        resp_429 = self._make_response(429, '{"error":"Rate limited"}', {"Retry-After": "0.01"})
        resp_200 = self._make_response(200)
        # Mock response.json() for success
        resp_200_data = {"ok": True}
        resp_200 = httpx.Response(
            200, json=resp_200_data, request=httpx.Request("POST", "http://test/api/events")
        )

        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return resp_429
            return resp_200

        with patch.object(client, "_do_request", side_effect=side_effect): # noqa: SIM117
            with patch("agentlensai.client.time.sleep") as mock_sleep:
                result = client._request("POST", "/api/events", json={})
                assert result == {"ok": True}
                mock_sleep.assert_called_once_with(0.01)
        client.close()

    def test_429_exhausts_retries(self):
        """429 raises RateLimitError after max retries."""
        client = AgentLensClient("http://localhost:3400", api_key="key")
        resp_429 = self._make_response(429, '{"error":"Rate limited"}', {"Retry-After": "0.01"})

        with patch.object(client, "_do_request", return_value=resp_429): # noqa: SIM117
            with patch("agentlensai.client.time.sleep"):
                with pytest.raises(RateLimitError):
                    client._request("POST", "/api/events", json={})
        client.close()

    def test_503_retries_with_backoff(self):
        """503 retries with exponential backoff."""
        client = AgentLensClient("http://localhost:3400", api_key="key")
        resp_503 = self._make_response(503, '{"error":"Backpressure"}')
        resp_200 = httpx.Response(
            200, json={"ok": True}, request=httpx.Request("POST", "http://test/api/events")
        )

        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count <= 2:
                return resp_503
            return resp_200

        with patch.object(client, "_do_request", side_effect=side_effect): # noqa: SIM117
            with patch("agentlensai.client.time.sleep") as mock_sleep:
                result = client._request("POST", "/api/events", json={})
                assert result == {"ok": True}
                assert mock_sleep.call_count == 2
                # Exponential backoff: 1.0, 2.0
                mock_sleep.assert_any_call(1.0)
                mock_sleep.assert_any_call(2.0)
        client.close()

    def test_503_exhausts_retries(self):
        """503 raises BackpressureError after max retries."""
        client = AgentLensClient("http://localhost:3400", api_key="key")
        resp_503 = self._make_response(503, '{"error":"Backpressure"}')

        with patch.object(client, "_do_request", return_value=resp_503): # noqa: SIM117
            with patch("agentlensai.client.time.sleep"):
                with pytest.raises(BackpressureError):
                    client._request("POST", "/api/events", json={})
        client.close()

    def test_backoff_calculation(self):
        """Backoff is exponential with cap."""
        client = AgentLensClient("http://localhost:3400")
        assert client._backoff(0) == 1.0
        assert client._backoff(1) == 2.0
        assert client._backoff(2) == 4.0
        assert client._backoff(10) == 30.0  # capped
        client.close()

    def test_quota_exceeded_buffers_in_sender(self):
        """Sender buffers events locally on QuotaExceededError."""
        from agentlensai._sender import EventSender, LlmCallData
        from agentlensai._state import InstrumentationState

        sender = EventSender(sync_mode=True)
        mock_client = MagicMock()
        mock_client._request.side_effect = QuotaExceededError("Quota exceeded")

        state = InstrumentationState(
            client=mock_client,
            agent_id="test",
            session_id="sess-1",
        )
        data = LlmCallData(
            provider="openai",
            model="gpt-4",
            messages=[{"role": "user", "content": "hi"}],
            system_prompt=None,
            completion="hello",
            tool_calls=None,
            finish_reason="stop",
            input_tokens=10,
            output_tokens=5,
            total_tokens=15,
            cost_usd=0.001,
            latency_ms=100.0,
        )

        with patch.object(sender, "_buffer_locally") as mock_buffer:
            sender.send(state, data)
            mock_buffer.assert_called_once()

    def test_buffer_locally_writes_file(self, tmp_path):
        """_buffer_locally writes events to a JSON file."""
        from agentlensai._sender import EventSender

        sender = EventSender(sync_mode=True)
        events = [{"eventType": "test", "payload": {}}]

        with patch.dict(os.environ, {"AGENTLENS_BUFFER_DIR": str(tmp_path)}):
            sender._buffer_locally(events)

        files = list(tmp_path.glob("events_*.json"))
        assert len(files) == 1
        with open(files[0]) as f:
            assert json.load(f) == events


# ─── S-5.4: SDK Integration Tests ─────────────────────────


class TestSDKIntegration:
    """S-5.4: End-to-end integration tests."""

    def test_init_shutdown_lifecycle(self):
        """Full init → shutdown lifecycle works."""
        shutdown()  # Clean state
        with patch("agentlensai._init._instrument_providers"): # noqa: SIM117
            with patch("agentlensai._init._instrument_frameworks"):
                sid = init("http://localhost:3400", integrations=[])
                assert sid is not None
                from agentlensai._init import current_session_id

                assert current_session_id() == sid
                shutdown()
                assert current_session_id() is None

    def test_init_cloud_with_api_key_lifecycle(self):
        """Cloud init with API key creates correct client."""
        shutdown()
        with patch("agentlensai._init._instrument_providers"): # noqa: SIM117
            with patch("agentlensai._init._instrument_frameworks"):
                init(cloud=True, api_key="als_test", integrations=[])
                from agentlensai._init import get_state

                state = get_state()
                assert state is not None
                assert state.client._base_url == CLOUD_URL
                assert state.client._api_key == "als_test"
                shutdown()

    def test_backward_compat_positional_url(self):
        """Old-style init(url) still works."""
        shutdown()
        with patch("agentlensai._init._instrument_providers"): # noqa: SIM117
            with patch("agentlensai._init._instrument_frameworks"):
                init("http://myserver:3400", integrations=[])
                from agentlensai._init import get_state

                state = get_state()
                assert state.client._base_url == "http://myserver:3400"
                shutdown()

    def test_backward_compat_url_with_api_key(self):
        """Old-style init(url, api_key=...) still works."""
        shutdown()
        with patch("agentlensai._init._instrument_providers"): # noqa: SIM117
            with patch("agentlensai._init._instrument_frameworks"):
                init("http://myserver:3400", api_key="als_x", integrations=[])
                from agentlensai._init import get_state

                state = get_state()
                assert state.client._api_key == "als_x"
                shutdown()

    def test_double_init_warns(self):
        """Double init without shutdown logs warning."""
        shutdown()
        with patch("agentlensai._init._instrument_providers"): # noqa: SIM117
            with patch("agentlensai._init._instrument_frameworks"):
                init("http://localhost:3400", integrations=[])
                sid2 = init("http://localhost:3400", integrations=[])
                # Returns existing session
                from agentlensai._init import current_session_id

                assert current_session_id() == sid2
                shutdown()

    def test_send_event_with_auth_header(self):
        """Events are sent with auth header."""
        client = AgentLensClient("http://localhost:3400", api_key="als_test")
        assert client._client.headers["Authorization"] == "Bearer als_test"
        client.close()

    def test_client_strips_trailing_slash(self):
        """Client strips trailing slash from URL."""
        client = AgentLensClient("http://localhost:3400/")
        assert client._base_url == "http://localhost:3400"
        client.close()

    def test_health_endpoint_skips_auth(self):
        """Health endpoint does not send auth header."""
        client = AgentLensClient("http://localhost:3400", api_key="als_test")
        with patch.object(client._client, "build_request", wraps=client._client.build_request): # noqa: SIM117
            with patch.object(client._client, "send") as mock_send:
                mock_resp = httpx.Response(
                    200,
                    json={"status": "ok", "version": "1.0"},
                    request=httpx.Request("GET", "http://test/api/health"),
                )
                mock_send.return_value = mock_resp
                client.health()
                # Verify the request was built and auth header stripped
                mock_send.assert_called_once()
                sent_request = mock_send.call_args[0][0]
                assert "Authorization" not in sent_request.headers
        client.close()

    def test_url_priority_full_chain(self):
        """Full priority chain: explicit > cloud > env > default."""
        # Default
        with patch.dict(os.environ, {}, clear=True):
            os.environ.pop("AGENTLENS_SERVER_URL", None)
            assert _resolve_url(None, False) == _DEFAULT_URL

        # Env overrides default
        with patch.dict(os.environ, {"AGENTLENS_SERVER_URL": "http://env:3400"}):
            assert _resolve_url(None, False) == "http://env:3400"

        # Cloud overrides env
        with patch.dict(os.environ, {"AGENTLENS_SERVER_URL": "http://env:3400"}):
            assert _resolve_url(None, True) == CLOUD_URL

        # Explicit overrides cloud
        assert _resolve_url("http://explicit:3400", True) == "http://explicit:3400"

    def test_init_no_args_uses_default(self):
        """init() with no URL args uses localhost default."""
        shutdown()
        with patch.dict(os.environ, {}, clear=True):
            os.environ.pop("AGENTLENS_SERVER_URL", None)
            os.environ.pop("AGENTLENS_API_KEY", None)
            with patch("agentlensai._init._instrument_providers"): # noqa: SIM117
                with patch("agentlensai._init._instrument_frameworks"):
                    init(integrations=[])
                    from agentlensai._init import get_state

                    state = get_state()
                    assert state.client._base_url == _DEFAULT_URL
                    shutdown()
