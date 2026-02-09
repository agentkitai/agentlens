#!/bin/bash
# AgentLens v0.10.0 Demo Script — Multi-Provider Auto-Instrumentation
# This script demonstrates the key features for an asciinema recording

set -e

# Simulate typing with delays for asciinema
type_cmd() {
    echo ""
    echo "$ $1"
    sleep 1.5
}

clear
echo "🔍 AgentLens v0.10.0 — Multi-Provider Auto-Instrumentation Demo"
echo "================================================================"
sleep 4

type_cmd "# Install AgentLens with all 9 LLM providers"
type_cmd "pip install agentlensai[all-providers]"
echo "Successfully installed agentlensai-0.10.0"
echo "  ✅ openai>=1.0.0"
echo "  ✅ anthropic>=0.20.0"
echo "  ✅ litellm>=1.0"
echo "  ✅ boto3>=1.28 (Bedrock)"
echo "  ✅ google-cloud-aiplatform>=1.38 (Vertex AI)"
echo "  ✅ google-generativeai>=0.3 (Gemini)"
echo "  ✅ mistralai>=0.1"
echo "  ✅ cohere>=5.0"
echo "  ✅ ollama>=0.1"
sleep 4

type_cmd "# Or install specific providers:"
type_cmd "pip install agentlensai[openai,bedrock,ollama]"
sleep 2.5

type_cmd "python3 << 'EOF'"
cat << 'PYEOF'
import agentlensai

# One line — auto-discovers and instruments all installed providers
agentlensai.init(
    url="http://localhost:3400",
    api_key="als_demo_key",
    agent_id="demo-agent",
    integrations="auto",
)

# Check what's registered
from agentlensai.integrations.registry import get_registry
registry = get_registry()
print(f"\n📦 Registered providers ({len(registry.integrations)}):")
for name, integration in registry.integrations.items():
    status = "✅ active" if integration.is_active else "⏸ available"
    print(f"  {name}: {status}")

# Every LLM call is now captured automatically!
# Example with OpenAI:
import openai
client = openai.OpenAI()
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "What is AgentLens?"}],
)
print(f"\n🧠 OpenAI response captured: {response.choices[0].message.content[:80]}...")

# Works with any supported provider — Anthropic, Bedrock, Ollama, etc.
# All calls logged with: model, tokens, cost, latency, full prompt/completion

agentlensai.shutdown()
print("\n✅ All events flushed to AgentLens server")
PYEOF
sleep 4

echo ""
echo "📦 Registered providers (9):"
echo "  openai: ✅ active"
echo "  anthropic: ✅ active"
echo "  litellm: ✅ active"
echo "  bedrock: ✅ active"
echo "  vertex: ✅ active"
echo "  gemini: ✅ active"
echo "  mistral: ✅ active"
echo "  cohere: ✅ active"
echo "  ollama: ✅ active"
sleep 2.5

echo ""
echo "🧠 OpenAI response captured: AgentLens is an open-source observability platform for AI agents..."
sleep 2.5

echo ""
echo "✅ All events flushed to AgentLens server"
sleep 4

echo ""
echo "🎉 That's it! Every LLM call across 9 providers — captured with one line."
echo "   Dashboard: http://localhost:3400"
echo "   Docs: https://github.com/amitpaz/agentlens"
sleep 5
