#!/bin/bash
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

type_it() {
  local text="$1"
  local i
  for ((i=0; i<${#text}; i++)); do
    printf '%s' "${text:$i:1}"
    sleep 0.03
  done
  printf '\n'
}

clear
sleep 0.5
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
sleep 0.1
echo -e "${BLUE}  🔍 AgentLens — Observability & Audit Trail for AI Agents${NC}"
sleep 0.1
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
sleep 2

echo
echo -e "${GREEN}# Your AI agent runs tasks, calls tools, spends tokens...${NC}"
sleep 0.5
echo -e "${DIM}# But can you see what it actually did?${NC}"
sleep 0.3
echo -e "${DIM}# AgentLens captures everything as tamper-evident events.${NC}"
sleep 2

# ─── Step 1: Start server ───
echo
echo -e "${BOLD}▶ Step 1:${NC} Start AgentLens server"
echo -e "${DIM}─────────────────────────────────────────${NC}"
sleep 1
type_it '$ agentlens serve --port 3400 --auth-disabled'
sleep 0.5
echo -e "   ${GREEN}✓${NC} AgentLens server listening on ${CYAN}http://localhost:3400${NC}"
echo -e "   ${DIM}  Auth: disabled (dev mode) | DB: agentlens.db${NC}"
sleep 2

# ─── Step 2: Agent starts session ───
echo
echo -e "${BOLD}▶ Step 2:${NC} AI agent starts a session"
echo -e "${DIM}─────────────────────────────────────────${NC}"
sleep 1
echo -e "${BOLD}🤖 Agent${NC} ${DIM}(via SDK / MCP tool)${NC}"
sleep 0.5
type_it '   "Starting research task. Let me log into AgentLens."'
sleep 1

echo
echo -e "${DIM}─── POST /api/events ───${NC}"
sleep 0.5
echo -e "${YELLOW}  {${NC}"
sleep 0.15
echo -e "${YELLOW}    \"sessionId\":  \"sess-research-42\",${NC}"
sleep 0.15
echo -e "${YELLOW}    \"agentId\":    \"research-agent\",${NC}"
sleep 0.15
echo -e "${YELLOW}    \"eventType\":  \"session_started\",${NC}"
sleep 0.15
echo -e "${YELLOW}    \"payload\": {${NC}"
sleep 0.15
echo -e "${YELLOW}      \"agentName\":    \"Research Agent\",${NC}"
sleep 0.15
echo -e "${YELLOW}      \"agentVersion\": \"2.0.1\"${NC}"
sleep 0.15
echo -e "${YELLOW}    }${NC}"
sleep 0.15
echo -e "${YELLOW}  }${NC}"
sleep 1

echo
echo -e "${DIM}─── Response ───${NC}"
sleep 0.3
echo -e "${GREEN}  ✓ ${NC}id: ${CYAN}01KGY513FFXF6WWVQ3EXX87JCZ${NC}"
echo -e "${GREEN}  ✓ ${NC}hash: ${CYAN}04c71242cb3f...67370c8d${NC}"
sleep 2

# ─── Step 3: Tool calls ───
echo
echo -e "${BOLD}▶ Step 3:${NC} Agent makes tool calls — all captured"
echo -e "${DIM}─────────────────────────────────────────${NC}"
sleep 1

echo -e "${BOLD}🤖 Agent${NC} calls ${CYAN}web_search${NC}"
sleep 0.3
echo -e "   ${YELLOW}toolName: \"web_search\"${NC}"
echo -e "   ${YELLOW}args: { query: \"latest AI safety research 2026\" }${NC}"
sleep 0.5
echo -e "   ${GREEN}✓${NC} hash: ${CYAN}12c1f335275a...59547d0f${NC}  ${DIM}← chains to previous${NC}"
sleep 1.5

echo -e "${BOLD}🤖 Agent${NC} calls ${CYAN}file_write${NC}"
sleep 0.3
echo -e "   ${YELLOW}toolName: \"file_write\"${NC}"
echo -e "   ${YELLOW}args: { path: \"research-notes.md\" }${NC}"
sleep 0.5
echo -e "   ${GREEN}✓${NC} hash: ${CYAN}0a5d753f5cdd...8a6a24${NC}  ${DIM}← chains to previous${NC}"
sleep 1.5

echo -e "${BOLD}🤖 Agent${NC} calls ${CYAN}exec${NC} ${RED}— ERROR${NC}"
sleep 0.3
echo -e "   ${YELLOW}toolName: \"exec\"${NC}"
echo -e "   ${RED}error: \"Permission denied: sudo blocked by policy\"${NC}"
sleep 0.5
echo -e "   ${GREEN}✓${NC} hash: ${CYAN}a74d3f1be3bd...fbc199${NC}  ${DIM}← chains to previous${NC}"
sleep 2

# ─── Step 4: Cost tracking ───
echo
echo -e "${BOLD}▶ Step 4:${NC} Costs tracked per model, per session"
echo -e "${DIM}─────────────────────────────────────────${NC}"
sleep 1
echo -e "   ${YELLOW}provider:     ${NC}anthropic"
echo -e "   ${YELLOW}model:        ${NC}claude-opus-4-6"
echo -e "   ${YELLOW}inputTokens:  ${NC}5,200"
echo -e "   ${YELLOW}outputTokens: ${NC}1,800"
echo -e "   ${YELLOW}costUsd:      ${NC}${GREEN}\$0.135${NC}"
sleep 2

# ─── Step 5: Query it all back ───
echo
echo -e "${BOLD}▶ Step 5:${NC} Query sessions, events, analytics"
echo -e "${DIM}─────────────────────────────────────────${NC}"
sleep 1
type_it '$ curl localhost:3400/api/sessions'
sleep 0.5

echo -e "${CYAN}  ┌─────────────────────┬──────────────────┬────────┬───────┬──────────┐${NC}"
sleep 0.1
echo -e "${CYAN}  │ Session             │ Agent            │ Events │ Errors│ Cost     │${NC}"
sleep 0.1
echo -e "${CYAN}  ├─────────────────────┼──────────────────┼────────┼───────┼──────────┤${NC}"
sleep 0.1
echo -e "${CYAN}  │${NC} sess-research-42    ${CYAN}│${NC} Research Agent   ${CYAN}│${NC}    5   ${CYAN}│${NC} ${RED}1${NC}     ${CYAN}│${NC} ${GREEN}\$0.135${NC}   ${CYAN}│${NC}"
sleep 0.1
echo -e "${CYAN}  │${NC} sess-review-17      ${CYAN}│${NC} Code Reviewer    ${CYAN}│${NC}    3   ${CYAN}│${NC} 0     ${CYAN}│${NC} ${GREEN}\$0.420${NC}   ${CYAN}│${NC}"
sleep 0.1
echo -e "${CYAN}  └─────────────────────┴──────────────────┴────────┴───────┴──────────┘${NC}"
sleep 2

# ─── Step 6: Hash chain integrity ───
echo
echo -e "${BOLD}▶ Step 6:${NC} Verify tamper-evident hash chain"
echo -e "${DIM}─────────────────────────────────────────${NC}"
sleep 1
type_it '$ curl localhost:3400/api/sessions/sess-research-42/timeline'
sleep 0.5

echo -e "   Event 1 → hash: ${CYAN}04c712...${NC}  prevHash: ${DIM}null${NC}"
sleep 0.3
echo -e "   Event 2 → hash: ${CYAN}12c1f3...${NC}  prevHash: ${CYAN}04c712...${NC} ${GREEN}✓${NC}"
sleep 0.3
echo -e "   Event 3 → hash: ${CYAN}0a5d75...${NC}  prevHash: ${CYAN}12c1f3...${NC} ${GREEN}✓${NC}"
sleep 0.3
echo -e "   Event 4 → hash: ${CYAN}a74d3f...${NC}  prevHash: ${CYAN}0a5d75...${NC} ${GREEN}✓${NC}"
sleep 0.3
echo -e "   Event 5 → hash: ${CYAN}89ec33...${NC}  prevHash: ${CYAN}a74d3f...${NC} ${GREEN}✓${NC}"
sleep 0.5
echo
echo -e "   ${GREEN}${BOLD}chainValid: true${NC}  ${DIM}— every event cryptographically linked${NC}"
sleep 2

# ─── Step 7: Alerting ───
echo
echo -e "${BOLD}▶ Step 7:${NC} Set up alerts"
echo -e "${DIM}─────────────────────────────────────────${NC}"
sleep 1
type_it '$ curl -X POST localhost:3400/api/alerts/rules'
sleep 0.5
echo -e "   ${YELLOW}name:${NC}      \"High Error Rate\""
echo -e "   ${YELLOW}condition:${NC} error_rate_exceeds 10%"
echo -e "   ${YELLOW}window:${NC}    last 60 minutes"
echo -e "   ${YELLOW}webhook:${NC}   ${CYAN}https://hooks.slack.com/...${NC}"
sleep 0.5
echo
echo -e "   ${RED}🔔 Alert triggered:${NC} Error rate ${RED}20%${NC} exceeds threshold ${YELLOW}10%${NC}"
sleep 0.5
echo -e "   ${DIM}→ Webhook fired to Slack${NC}"
sleep 2

# ─── Closing ───
echo
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
sleep 0.1
echo -e "${BLUE}  Every tool call. Every token. Every decision.${NC}"
sleep 0.1
echo -e "${BLUE}  Tamper-evident. Hash-chained. MCP-native.${NC}"
sleep 0.1
echo -e "${BLUE}  → github.com/amitpaz1/agentlens${NC}"
sleep 0.1
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
sleep 8
