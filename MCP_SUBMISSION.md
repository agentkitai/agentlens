# MCP directory submissions — prep & steps

Two targets. Both submissions are **outward actions you trigger** (publishing to a
registry / opening PRs on third-party repos). This repo now contains everything
needed; the steps below are the manual part.

Status (verified June 2026): AgentLens is **not yet listed** in either —
`https://registry.modelcontextprotocol.io/v0.1/servers?search=agentlens` → `count: 0`.

---

## 1. Official MCP Registry (`registry.modelcontextprotocol.io`)

The official path is **not** a README PR — it's a `server.json` published with the
`mcp-publisher` CLI (GitHub OAuth). The `modelcontextprotocol/servers` README now
only lists steering-group reference servers and redirects third parties here.

### Blocker — handled in this PR
The registry verifies ownership by requiring the published npm package to carry a
top-level **`mcpName`** matching `server.json` `name`. Published `@agentkitai/agentlens-mcp@0.13.0`
lacked it. This PR:
- adds `"mcpName": "io.github.agentkitai/agentlens"` to `packages/mcp/package.json`
- bumps it `0.13.0 → 0.13.1` (npm versions are immutable, so a republish needs a new version)
- adds `packages/mcp/server.json` (the manifest; `description` is ≤100 chars per the live schema cap)

### Steps (you)
1. **Republish the mcp package with `mcpName`.** Merge this PR, then cut a release tag
   (`vX.Y.Z`) — the OIDC release pipeline republishes `@agentkitai/agentlens-mcp@0.13.1`.
   Confirm: `npm view @agentkitai/agentlens-mcp mcpName` → `io.github.agentkitai/agentlens`.
2. **Install the publisher CLI** (Windows PowerShell):
   ```powershell
   $arch = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq "Arm64") {"arm64"} else {"amd64"}
   Invoke-WebRequest "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_$arch.tar.gz" -OutFile mcp-publisher.tar.gz
   tar xf mcp-publisher.tar.gz mcp-publisher.exe ; rm mcp-publisher.tar.gz
   ```
3. **Auth + publish** from `packages/mcp/` (must be an authorized member of the `agentkitai` GitHub org for the `io.github.agentkitai/*` namespace):
   ```
   mcp-publisher login github
   mcp-publisher publish        # uses ./server.json
   ```
4. **Verify:** `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=agentlens"`

> If org-namespace publishing isn't available, fall back to `io.github.amitpaz/*` —
> set both `mcpName` (package.json) and `server.json` `name` to match.

---

## 2. `punkpeye/awesome-mcp-servers` (89.5k★, the canonical community list)

A plain README markdown bullet. **No `mcpName` needed.**

### Exact entry
Place in the **`### 📊 Monitoring`** section, alphabetically by `owner/repo` slug —
between `adanb13/cirdan` and `alilxxey/openobserve-community-mcp`:

```markdown
- [agentkitai/agentlens](https://github.com/agentkitai/agentlens) 📇 🏠 ☁️ 🍎 🪟 🐧 - Tamper-evident observability for AI agents: a SHA-256 hash-chained audit log with chain verification and signed export (EU AI Act Art. 12). Instrument any agent with zero code via `npx -y @agentkitai/agentlens-mcp`; also ingests OpenTelemetry GenAI traces.
```

Icons (per the repo's legend): 📇 TypeScript · 🏠 local/self-hosted · ☁️ cloud option · 🍎🪟🐧 macOS/Windows/Linux. (This icon order has a live precedent in the same section.)

### Steps (you)
1. Fork `punkpeye/awesome-mcp-servers`; branch `add-agentlens`.
2. Insert the line above in the Monitoring section (match surrounding format exactly: `- `, single spaces between icons, ` - ` before the description, trailing period).
3. Commit, push, open a PR against the default branch.
