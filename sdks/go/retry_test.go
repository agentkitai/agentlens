package agentlens

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestRetry429ThenSuccess(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		if n <= 2 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(429)
			w.Write([]byte(`{"error":"rate limited"}`))
			return
		}
		w.WriteHeader(200)
		w.Write([]byte(`{"status":"ok"}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "key", WithRetry(RetryConfig{
		MaxRetries:  3,
		BackoffBase: time.Millisecond,
		BackoffMax:  10 * time.Millisecond,
	}))

	var result HealthResult
	err := c.do(context.Background(), "GET", "/api/health", nil, &result, true)
	if err != nil {
		t.Fatalf("expected success after retries, got: %v", err)
	}
	if result.Status != "ok" {
		t.Errorf("expected status=ok, got %s", result.Status)
	}
	if calls.Load() != 3 {
		t.Errorf("expected 3 calls, got %d", calls.Load())
	}
}

func TestRetry503ThenSuccess(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		if n == 1 {
			w.WriteHeader(503)
			w.Write([]byte(`{"error":"backpressure"}`))
			return
		}
		w.WriteHeader(200)
		w.Write([]byte(`{"status":"ok"}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "key", WithRetry(RetryConfig{
		MaxRetries:  2,
		BackoffBase: time.Millisecond,
		BackoffMax:  10 * time.Millisecond,
	}))

	var result HealthResult
	err := c.do(context.Background(), "GET", "/api/health", nil, &result, true)
	if err != nil {
		t.Fatalf("expected success, got: %v", err)
	}
	if calls.Load() != 2 {
		t.Errorf("expected 2 calls, got %d", calls.Load())
	}
}

func TestNoRetryOn401(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(401)
		w.Write([]byte(`{"error":"unauthorized"}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "key", WithRetry(RetryConfig{
		MaxRetries:  3,
		BackoffBase: time.Millisecond,
		BackoffMax:  10 * time.Millisecond,
	}))

	var result HealthResult
	err := c.do(context.Background(), "GET", "/test", nil, &result, false)
	if err == nil {
		t.Fatal("expected error")
	}
	if calls.Load() != 1 {
		t.Errorf("expected 1 call (no retry on 401), got %d", calls.Load())
	}
}

func TestContextCancellation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(429)
		w.Write([]byte(`{"error":"rate limited"}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "key", WithRetry(RetryConfig{
		MaxRetries:  5,
		BackoffBase: time.Second,
		BackoffMax:  5 * time.Second,
	}))

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	var result HealthResult
	err := c.do(ctx, "GET", "/test", nil, &result, false)
	if err == nil {
		t.Fatal("expected error from cancelled context")
	}
}

func TestShouldRetry(t *testing.T) {
	if shouldRetry(nil) {
		t.Error("nil should not be retryable")
	}
	if shouldRetry(mapHTTPError(400, "bad", nil, nil)) {
		t.Error("400 should not be retryable")
	}
	if shouldRetry(mapHTTPError(401, "unauth", nil, nil)) {
		t.Error("401 should not be retryable")
	}
	if !shouldRetry(mapHTTPError(429, "rl", nil, nil)) {
		t.Error("429 should be retryable")
	}
	if !shouldRetry(mapHTTPError(503, "bp", nil, nil)) {
		t.Error("503 should be retryable")
	}
	connErr := &ConnectionError{APIError: newAPIError("timeout", 0, "CONNECTION_ERROR", nil)}
	if !shouldRetry(connErr) {
		t.Error("ConnectionError should be retryable")
	}
}
