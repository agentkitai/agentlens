# Show HN draft

**Title:**
Show HN: AgentLens – Tamper-evident audit logs for AI agents (hash-chained, OTel-native)

**URL:** https://github.com/agentkitai/agentlens

---

## Post body

Hi HN — AgentLens is open-source observability for AI agents with one thing the other tools don't lead with: a **tamper-evident audit log**. Every event (LLM call, tool call, approval, error) is **SHA-256 hash-chained** to the previous one, the way git commits and blockchains are. The log is append-only and **cryptographically verifiable** — alter, delete, or reorder a single record after the fact and verification fails, pointing at the exact event that broke. You can export a signed JSON snapshot for an auditor.

I built this because agents are starting to take real, consequential actions, and "trust me, here are some logs" isn't good enough when something goes wrong — or when a regulator asks. The EU AI Act's Article 12 requires automatic record-keeping over the lifetime of high-risk systems, and there's early IETF work on an agent audit trail. Tools like Langfuse / LangSmith / Phoenix are great at observability, but none of them lead with a *verifiable* audit trail. That's the gap.

See the tamper-evidence in ~30 seconds (needs Docker):

```
git clone https://github.com/agentkitai/agentlens && cd agentlens
./demo/aha.sh
```

It ingests a real agent trace, verifies the hash chain (passes), edits one record directly in the database behind the audit log's back, then re-verifies — and the chain catches it.

Run the whole thing with one command (SQLite, zero config):

```
docker run -p 3400:3400 -e AUTH_DISABLED=true -e JWT_SECRET=dev-secret ghcr.io/agentkitai/agentlens
```

It also speaks **OpenTelemetry**: if your agent already emits `gen_ai.*` spans (OpenLLMetry, OpenInference, official OTel instrumentations), just point your OTLP exporter at it — no AgentLens SDK required, and those traces get the same hash-chained audit trail. There's also a Python auto-instrumentation SDK, an MCP server (~22 tools), and a real-time dashboard.

**Honest about where it is:** it's young. The audit-log/chain-verification core and the OTel ingest are solid and tested; the cloud offering and some framework integrations are earlier. Cost attribution for OTel-ingested calls isn't wired up yet (tokens are captured). MIT licensed. Self-hosted by default, no external dependencies.

I'd love feedback specifically on the audit-log design and the compliance angle — is verifiable tamper-evidence something you'd actually want in your agent stack, or is observability enough?

---

## Notes for posting (not part of the post)

- Post Tue–Thu, ~8–10am ET, as a text post (Show HN). Be present in the thread for the first few hours.
- Lead the discussion toward the moat (hash chain, compliance) — that's the differentiator vs. Langfuse/LangSmith/Phoenix.
- Have the 30s demo working: this requires the `ghcr.io/agentkitai/agentlens` image to be published (first release tag) BEFORE posting, or the `docker run`/`./demo/aha.sh` commands fail. ← gate on first release.
- Screenshots/gif of the dashboard + the tamper demo land well in comments.
