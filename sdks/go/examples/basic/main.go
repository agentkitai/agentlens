// Example basic demonstrates the core AgentLens Go SDK usage.
package main

import (
	"context"
	"fmt"
	"log"

	agentlens "github.com/agentkitai/agentlens-go"
)

func main() {
	// Create client from environment variables
	client := agentlens.NewClientFromEnv()
	ctx := context.Background()

	// Check server health
	health, err := client.Health(ctx)
	if err != nil {
		log.Fatalf("health check failed: %v", err)
	}
	fmt.Printf("Server: %s (v%s)\n", health.Status, health.Version)

	// Log an LLM call
	completion := "Hello! How can I help you today?"
	callID, err := client.LogLlmCall(ctx, "session-1", "agent-1", &agentlens.LogLlmCallParams{
		Provider:     "openai",
		Model:        "gpt-4",
		Messages:     []agentlens.LlmMessage{{Role: "user", Content: "Hello"}},
		Completion:   &completion,
		FinishReason: "stop",
		Usage:        agentlens.LlmUsage{InputTokens: 5, OutputTokens: 10, TotalTokens: 15},
		CostUsd:      0.001,
		LatencyMs:    250,
	})
	if err != nil {
		log.Fatalf("log LLM call failed: %v", err)
	}
	fmt.Printf("Logged LLM call: %s\n", callID)

	// Query events
	sid := "session-1"
	result, err := client.QueryEvents(ctx, &agentlens.EventQuery{SessionID: &sid})
	if err != nil {
		log.Fatalf("query events failed: %v", err)
	}
	fmt.Printf("Found %d events\n", result.Total)

	// BatchSender for high-throughput
	bs := agentlens.NewBatchSender(client.SendEvents, agentlens.WithMaxBatchSize(50))
	bs.Enqueue(agentlens.Event{SessionID: "s1", AgentID: "a1", EventType: "custom", Severity: "info"})
	if err := bs.Shutdown(ctx); err != nil {
		log.Fatalf("batch shutdown failed: %v", err)
	}
	fmt.Println("Done!")
}
