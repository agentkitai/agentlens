package agentlens

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestNewClient(t *testing.T) {
	c := NewClient("http://localhost:3400", "test-key")
	if c.cfg.url != "http://localhost:3400" {
		t.Errorf("unexpected url: %s", c.cfg.url)
	}
	if c.cfg.apiKey != "test-key" {
		t.Errorf("unexpected apiKey: %s", c.cfg.apiKey)
	}
	if c.cfg.timeout != 30*time.Second {
		t.Errorf("unexpected timeout: %v", c.cfg.timeout)
	}
}

func TestNewClientFromEnv(t *testing.T) {
	os.Setenv("AGENTLENS_SERVER_URL", "http://test:9999")
	os.Setenv("AGENTLENS_API_KEY", "env-key")
	defer os.Unsetenv("AGENTLENS_SERVER_URL")
	defer os.Unsetenv("AGENTLENS_API_KEY")

	c := NewClientFromEnv()
	if c.cfg.url != "http://test:9999" {
		t.Errorf("unexpected url: %s", c.cfg.url)
	}
	if c.cfg.apiKey != "env-key" {
		t.Errorf("unexpected apiKey: %s", c.cfg.apiKey)
	}
}

func TestNewClientTrailingSlash(t *testing.T) {
	c := NewClient("http://localhost:3400///", "key")
	if c.cfg.url != "http://localhost:3400" {
		t.Errorf("trailing slash not stripped: %s", c.cfg.url)
	}
}

func TestAuthHeader(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if auth != "Bearer my-key" {
			t.Errorf("expected Bearer my-key, got %s", auth)
		}
		w.WriteHeader(200)
		w.Write([]byte(`{"events":[],"total":0,"hasMore":false}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "my-key")
	_, err := c.QueryEvents(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
}

func TestHealthSkipsAuth(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if auth := r.Header.Get("Authorization"); auth != "" {
			t.Errorf("Health should not send Authorization, got %s", auth)
		}
		w.WriteHeader(200)
		w.Write([]byte(`{"status":"ok","version":"1.0.0"}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "my-key")
	result, err := c.Health(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "ok" {
		t.Errorf("expected ok, got %s", result.Status)
	}
}

func TestQueryEvents(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("sessionId") != "s1" {
			t.Errorf("expected sessionId=s1, got %s", r.URL.Query().Get("sessionId"))
		}
		json.NewEncoder(w).Encode(EventQueryResult{
			Events:  []Event{{ID: "e1", SessionID: "s1"}},
			Total:   1,
			HasMore: false,
		})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "key")
	sid := "s1"
	result, err := c.QueryEvents(context.Background(), &EventQuery{SessionID: &sid})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Events) != 1 || result.Events[0].ID != "e1" {
		t.Errorf("unexpected result: %+v", result)
	}
}

func TestGetEvent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(Event{ID: "e1", EventType: "llm_call"})
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "key")
	e, err := c.GetEvent(context.Background(), "e1")
	if err != nil {
		t.Fatal(err)
	}
	if e.EventType != "llm_call" {
		t.Errorf("unexpected eventType: %s", e.EventType)
	}
}

func TestGetSessions(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(SessionQueryResult{Sessions: []Session{{ID: "s1"}}, Total: 1})
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "key")
	r, err := c.GetSessions(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if r.Total != 1 {
		t.Errorf("expected total=1, got %d", r.Total)
	}
}

func TestGetSession(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(Session{ID: "s1", Status: "active"})
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "key")
	s, err := c.GetSession(context.Background(), "s1")
	if err != nil {
		t.Fatal(err)
	}
	if s.Status != "active" {
		t.Errorf("unexpected status: %s", s.Status)
	}
}

func TestGetSessionTimeline(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(TimelineResult{Events: []Event{{ID: "e1"}}, ChainValid: true})
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "key")
	r, err := c.GetSessionTimeline(context.Background(), "s1")
	if err != nil {
		t.Fatal(err)
	}
	if !r.ChainValid {
		t.Error("expected chainValid=true")
	}
}

func TestGetAgent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(Agent{ID: "a1"})
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "key")
	a, err := c.GetAgent(context.Background(), "a1")
	if err != nil {
		t.Fatal(err)
	}
	if a.ID != "a1" {
		t.Errorf("unexpected id: %s", a.ID)
	}
}

func TestLogLlmCall(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		events := body["events"].([]any)
		if len(events) != 2 {
			t.Errorf("expected 2 events, got %d", len(events))
		}
		w.WriteHeader(200)
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "key")
	comp := "Hello!"
	callID, err := c.LogLlmCall(context.Background(), "s1", "a1", &LogLlmCallParams{
		Provider:     "openai",
		Model:        "gpt-4",
		Messages:     []LlmMessage{{Role: "user", Content: "Hi"}},
		Completion:   &comp,
		FinishReason: "stop",
		Usage:        LlmUsage{InputTokens: 10, OutputTokens: 5, TotalTokens: 15},
		CostUsd:      0.001,
		LatencyMs:    150,
	})
	if err != nil {
		t.Fatal(err)
	}
	if callID == "" {
		t.Error("expected non-empty callID")
	}
}

func TestGetLlmAnalytics(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(LlmAnalyticsResult{
			Summary: LlmAnalyticsSummary{TotalCalls: 42},
		})
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "key")
	r, err := c.GetLlmAnalytics(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if r.Summary.TotalCalls != 42 {
		t.Errorf("expected 42 calls, got %d", r.Summary.TotalCalls)
	}
}

func TestListGuardrails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(GuardrailRuleListResult{Rules: []GuardrailRule{{ID: "g1", Name: "test"}}})
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "key")
	r, err := c.ListGuardrails(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Rules) != 1 {
		t.Errorf("expected 1 rule, got %d", len(r.Rules))
	}
}

func TestCreateGuardrail(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		json.NewEncoder(w).Encode(GuardrailRule{ID: "g1", Name: "new-rule"})
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "key")
	r, err := c.CreateGuardrail(context.Background(), &CreateGuardrailParams{
		Name:            "new-rule",
		ConditionType:   "threshold",
		ConditionConfig: map[string]any{"max": 100},
		ActionType:      "alert",
		ActionConfig:    map[string]any{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Name != "new-rule" {
		t.Errorf("unexpected name: %s", r.Name)
	}
}

func TestDeleteGuardrail(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "DELETE" {
			t.Errorf("expected DELETE, got %s", r.Method)
		}
		w.WriteHeader(200)
		w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "key")
	err := c.DeleteGuardrail(context.Background(), "g1")
	if err != nil {
		t.Fatal(err)
	}
}

func TestVerifyAudit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(VerificationReport{Verified: true, TotalEvents: 100})
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "key")
	r, err := c.VerifyAudit(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !r.Verified {
		t.Error("expected verified=true")
	}
}

func TestFailOpen(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`{"error":"server error"}`))
	}))
	defer srv.Close()

	var captured error
	c := NewClient(srv.URL, "key",
		WithFailOpen(func(err error) { captured = err }),
		WithRetry(RetryConfig{MaxRetries: 0}),
	)

	result, err := c.QueryEvents(context.Background(), nil)
	if err != nil {
		t.Errorf("fail-open should not return error, got: %v", err)
	}
	if result == nil {
		t.Error("fail-open should return zero-value result")
	}
	if captured == nil {
		t.Error("expected onError to be called")
	}
}

func TestRecall(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("query") != "test query" {
			t.Errorf("unexpected query param: %s", r.URL.Query().Get("query"))
		}
		json.NewEncoder(w).Encode(RecallResult{Results: []any{"result1"}})
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "key")
	r, err := c.Recall(context.Background(), &RecallQuery{Query: "test query"})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Results) != 1 {
		t.Errorf("expected 1 result, got %d", len(r.Results))
	}
}
