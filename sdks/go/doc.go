// Package agentlens provides a Go client for the AgentLens REST API.
//
// AgentLens is an observability platform for AI agents. This SDK provides
// typed methods for all AgentLens API endpoints including event tracking,
// session management, LLM call logging, health monitoring, guardrails,
// and audit verification.
//
// # Quick Start
//
//	client := agentlens.NewClient("http://localhost:3400", "your-api-key")
//
//	// Or from environment variables (AGENTLENS_SERVER_URL, AGENTLENS_API_KEY)
//	client := agentlens.NewClientFromEnv()
//
//	// Log an LLM call
//	callID, err := client.LogLlmCall(ctx, "session-1", "agent-1", &agentlens.LogLlmCallParams{
//	    Provider: "openai",
//	    Model:    "gpt-4",
//	    // ...
//	})
//
//	// Query events
//	result, err := client.QueryEvents(ctx, &agentlens.EventQuery{SessionID: strPtr("session-1")})
//
// # Error Handling
//
// All API methods return typed errors that can be inspected with errors.As:
//
//	var authErr *agentlens.AuthenticationError
//	if errors.As(err, &authErr) {
//	    // handle 401
//	}
//
// # Fail-Open Mode
//
// For fire-and-forget telemetry, enable fail-open mode:
//
//	client := agentlens.NewClient(url, key, agentlens.WithFailOpen(func(err error) {
//	    log.Printf("agentlens error (ignored): %v", err)
//	}))
//
// # Batch Sending
//
// Use BatchSender for high-throughput event ingestion:
//
//	bs := agentlens.NewBatchSender(client.SendEvents, agentlens.WithMaxBatchSize(200))
//	bs.Enqueue(event)
//	defer bs.Shutdown(context.Background())
package agentlens
