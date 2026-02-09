#!/bin/bash
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
MAGENTA='\033[0;35m'
WHITE='\033[1;37m'
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

# ─── Step 1: Intro Banner ───
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${WHITE}  🔍 AgentLens v0.8.0 — Self-Aware AI Agent Platform${NC}"
echo -e "${DIM}     Agents that watch themselves get better.${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
sleep 3

# ─── Step 2: Install & Auto-Instrument ───
echo
echo -e "${BOLD}▶ Step 1:${NC} Install & auto-instrument ${DIM}(v0.4.0)${NC}"
echo -e "${DIM}─────────────────────────────────────────────${NC}"
sleep 0.5
type_it '$ pip install agentlensai[openai]'
sleep 0.3
echo -e "   ${GREEN}✓${NC} Successfully installed agentlensai-0.8.0"
sleep 1

echo
echo -e "${DIM}   # 3 lines to capture everything:${NC}"
sleep 0.3
echo -e "${YELLOW}   import agentlensai${NC}"
sleep 0.2
echo -e "${YELLOW}   agentlensai.init(url=\"http://localhost:3400\", api_key=\"als_xxx\", agent_id=\"my-agent\")${NC}"
sleep 0.2
echo -e "${DIM}   # Every LLM call now captured automatically${NC}"
sleep 2

# ─── Step 3: Agent runs with full capture ───
echo
echo -e "${BOLD}▶ Step 2:${NC} Agent runs — events flow in"
echo -e "${DIM}─────────────────────────────────────────────${NC}"
sleep 0.5

echo -e "   ${GREEN}●${NC} session_started    ${DIM}agent=my-agent${NC}"
sleep 0.4
echo -e "   ${GREEN}●${NC} llm_call           ${CYAN}claude-opus${NC}  1.2K tokens  ${GREEN}\$0.09${NC}"
sleep 0.4
echo -e "     ${DIM}hash: a3f7c2...  prev: 04c712...${NC} ${GREEN}✓${NC}"
sleep 0.3
echo -e "   ${GREEN}●${NC} tool_call          ${CYAN}web_search${NC}  ${DIM}query=\"latest benchmarks\"${NC}"
sleep 0.4
echo -e "   ${GREEN}●${NC} llm_response       ${DIM}820 tokens${NC}"
sleep 0.4
echo -e "   ${GREEN}●${NC} tool_call          ${CYAN}file_write${NC}  ${DIM}path=report.md${NC}"
sleep 0.4
echo -e "   ${GREEN}●${NC} cost_tracked       ${WHITE}\$0.42 total${NC}  ${DIM}hash chain valid${NC} ${GREEN}✓${NC}"
sleep 2

# ─── Step 4: Agent Self-Query ───
echo
echo -e "${BOLD}▶ Step 3:${NC} Agent recalls past mistakes ${DIM}(v0.5.0)${NC}"
echo -e "${DIM}─────────────────────────────────────────────${NC}"
sleep 0.5

echo -e "   🤖 Agent uses ${CYAN}agentlens_recall${NC}"
sleep 0.3
echo -e "      query: ${YELLOW}\"database migration errors\"${NC}"
sleep 0.5
echo -e "      → Found ${WHITE}3${NC} similar sessions, ${RED}2${NC} with failures"
sleep 0.4
echo -e "      → Lesson: ${GREEN}\"Always run migrations in a transaction\"${NC}"
sleep 2

# ─── Step 5: Guardrail Fires ───
echo
echo -e "${BOLD}▶ Step 4:${NC} Guardrail fires ${DIM}(v0.8.0)${NC}"
echo -e "${DIM}─────────────────────────────────────────────${NC}"
sleep 0.5

echo -e "   🛡️  Guardrail: ${RED}\"Cost Limit\"${NC} triggered"
sleep 0.3
echo -e "      condition: ${YELLOW}cost_limit > \$5.00/hour${NC}"
sleep 0.3
echo -e "      action:    ${CYAN}downgrade_model → claude-sonnet${NC}"
sleep 0.3
echo -e "      dry_run:   ${RED}false${NC}"
sleep 0.3
echo -e "      → ${WHITE}Agent model overridden${NC}"
sleep 2

# ─── Step 6: Dashboard & Analytics ───
echo
echo -e "${BOLD}▶ Step 5:${NC} Dashboard & analytics"
echo -e "${DIM}─────────────────────────────────────────────${NC}"
sleep 0.5
type_it '$ agentlens sessions'
sleep 0.3

echo -e "${CYAN}  ┌──────────────────┬────────────────┬────────┬────────┬──────────┐${NC}"
echo -e "${CYAN}  │${NC} Session          ${CYAN}│${NC} Agent          ${CYAN}│${NC} Events ${CYAN}│${NC} Health ${CYAN}│${NC} Cost     ${CYAN}│${NC}"
echo -e "${CYAN}  ├──────────────────┼────────────────┼────────┼────────┼──────────┤${NC}"
echo -e "${CYAN}  │${NC} sess-deploy-71   ${CYAN}│${NC} deploy-bot     ${CYAN}│${NC}    12  ${CYAN}│${NC} ${GREEN}94${NC}     ${CYAN}│${NC} ${GREEN}\$0.42${NC}    ${CYAN}│${NC}"
echo -e "${CYAN}  │${NC} sess-review-58   ${CYAN}│${NC} code-reviewer  ${CYAN}│${NC}     8  ${CYAN}│${NC} ${YELLOW}72${NC}     ${CYAN}│${NC} ${GREEN}\$1.87${NC}    ${CYAN}│${NC}"
echo -e "${CYAN}  │${NC} sess-research-33 ${CYAN}│${NC} research-agent ${CYAN}│${NC}    21  ${CYAN}│${NC} ${RED}51${NC}     ${CYAN}│${NC} ${YELLOW}\$4.90${NC}    ${CYAN}│${NC}"
echo -e "${CYAN}  └──────────────────┴────────────────┴────────┴────────┴──────────┘${NC}"
sleep 1.5

echo
type_it '$ agentlens health my-agent'
sleep 0.3
echo -e "   ${BOLD}Health Score: ${GREEN}87/100${NC}"
echo -e "   ${DIM}├─${NC} Errors:     ${GREEN}2%${NC}   (target <5%)"
echo -e "   ${DIM}├─${NC} Cost:       ${GREEN}\$1.20/hr${NC}  (limit \$5.00)"
echo -e "   ${DIM}├─${NC} Latency:    ${YELLOW}1.8s avg${NC}  (target <2s)"
echo -e "   ${DIM}├─${NC} Tools:      ${GREEN}98%${NC} success"
echo -e "   ${DIM}└─${NC} Completion: ${GREEN}94%${NC} tasks done"
sleep 2

# ─── Step 7: Closing Banner ───
echo
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${WHITE}  Every decision. Every token. Every lesson learned.${NC}"
echo -e "${BOLD}  Agents that watch themselves get better.${NC}"
echo
echo -e "${DIM}  github.com/amitpaz/agentlens${NC}"
echo -e "${DIM}  npm i agentlens  •  pip install agentlensai${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
sleep 8
