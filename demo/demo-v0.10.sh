#!/bin/bash
# AgentLens v0.10.0 Demo — Multi-Provider Auto-Instrumentation

# Simulate typing
typeit() {
    for ((i=0; i<${#1}; i++)); do
        printf '%s' "${1:$i:1}"
        sleep 0.04
    done
    echo ""
}

prompt() {
    printf '$ '
    sleep 0.3
    typeit "$1"
    sleep 0.8
}

clear
sleep 1
echo "🔍 AgentLens v0.10.0 — Multi-Provider Auto-Instrumentation"
echo "============================================================"
sleep 2

prompt "pip install agentlensai[all-providers]"
sleep 0.5
echo "Collecting agentlensai[all-providers]"
sleep 0.3
echo "  Downloading agentlensai-0.10.0-py3-none-any.whl"
sleep 0.3
echo "Installing collected packages: agentlensai"
sleep 0.5
echo "Successfully installed agentlensai-0.10.0"
sleep 2

prompt "python3 -c 'import agentlensai; agentlensai.init(integrations=\"auto\")'"
sleep 1
echo ""
echo "📦 Auto-discovered providers:"
sleep 0.3
echo "  ✅ openai        — GPT-4, GPT-3.5"
sleep 0.2
echo "  ✅ anthropic     — Claude 3/4 Opus, Sonnet, Haiku"
sleep 0.2
echo "  ✅ litellm       — 100+ providers via single adapter"
sleep 0.2
echo "  ✅ bedrock       — AWS Bedrock (Amazon Titan, Claude)"
sleep 0.2
echo "  ✅ vertex        — Google Vertex AI"
sleep 0.2
echo "  ✅ gemini        — Google Gemini API"
sleep 0.2
echo "  ✅ azure_openai  — Azure OpenAI Service"
sleep 0.2
echo "  ✅ mistral       — Mistral AI"
sleep 0.2
echo "  ✅ cohere        — Cohere Command"
sleep 0.5
echo ""
echo "🔗 All 9 providers instrumented. Zero code changes needed."
sleep 3

prompt "# Works with any provider — example with Anthropic:"
prompt "python3 << 'EOF'"
sleep 0.5
typeit "import anthropic"
typeit "client = anthropic.Anthropic()"
typeit "resp = client.messages.create("
typeit "    model='claude-sonnet-4-20250514',"
typeit "    max_tokens=100,"
typeit "    messages=[{'role': 'user', 'content': 'Hello!'}]"
typeit ")"
typeit "EOF"
sleep 1
echo ""
echo "🧠 Captured: model=claude-sonnet-4-20250514 tokens=23 cost=$0.0004 latency=342ms"
sleep 2

prompt "# Check the dashboard"
prompt "open http://localhost:3000"
sleep 1
echo ""
echo "📊 Dashboard → Sessions, LLM Calls, Cost Analytics, Health Scores"
echo "   All provider calls visible in one unified timeline."
sleep 3

echo ""
echo "🎉 AgentLens v0.10.0 — 9 providers, 1 line of code, full observability."
sleep 4
