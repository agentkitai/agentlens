# AgentLens Pricing

Choose the plan that fits your observability needs. All plans include the full AgentLens feature set — sessions, events, LLM tracking, guardrails, benchmarks, and the dashboard.

---

## Plans

### Free

**$0/month** — forever free

- **10,000 events/month**
- 1 organization
- 2 API keys
- 1 GB storage
- 7-day data retention
- Community support

Best for: Individual developers, hobby projects, evaluation.

---

### Pro

**$29/month** (or **$23/month** billed annually — save 20%)

- **1,000,000 events/month**
- 1 organization
- 10 API keys
- 100 GB storage
- 30-day data retention
- Email support
- Overage: $0.10 per 1,000 events

Best for: Small teams, startups, production agents.

---

### Team

**$99/month** (or **$79/month** billed annually — save 20%)

- **10,000,000 events/month**
- Unlimited organizations
- 50 API keys per org
- 1 TB storage
- 90-day data retention
- Priority support
- RBAC & audit log
- Overage: $0.08 per 1,000 events

Best for: Growing teams, multiple projects, compliance requirements.

---

### Enterprise

**Custom pricing** — contact sales

- **100,000,000+ events/month**
- Unlimited everything
- 200+ API keys per org
- 10 TB+ storage
- Custom data retention
- Dedicated support & SLA
- SSO / SAML
- Custom contracts
- On-premise deployment option

Best for: Large organizations, regulated industries, high-volume workloads.

---

## Feature Comparison

| Feature | Free | Pro | Team | Enterprise |
|---------|:----:|:---:|:----:|:----------:|
| Monthly events | 10K | 1M | 10M | 100M+ |
| API keys | 2 | 10 | 50 | 200+ |
| Storage | 1 GB | 100 GB | 1 TB | 10 TB+ |
| Data retention | 7 days | 30 days | 90 days | Custom |
| Organizations | 1 | 1 | Unlimited | Unlimited |
| Team members | 1 | 5 | Unlimited | Unlimited |
| Session replay | ✅ | ✅ | ✅ | ✅ |
| LLM cost tracking | ✅ | ✅ | ✅ | ✅ |
| Guardrails | ✅ | ✅ | ✅ | ✅ |
| Benchmarks | ✅ | ✅ | ✅ | ✅ |
| Alerting | — | ✅ | ✅ | ✅ |
| RBAC | — | — | ✅ | ✅ |
| Audit log | — | — | ✅ | ✅ |
| SSO / SAML | — | — | — | ✅ |
| SLA | — | — | — | ✅ |
| Support | Community | Email | Priority | Dedicated |
| Overage rate | Blocked | $0.10/1K | $0.08/1K | Custom |

---

## Frequently Asked Questions

### What counts as an event?

An event is any data point sent to AgentLens: LLM calls, tool invocations, agent actions, errors, guardrail checks, benchmarks, or custom events. Session start/end markers also count as events.

### What happens when I hit my event limit?

- **Free:** Ingestion is paused until the next billing cycle. Existing data remains accessible.
- **Pro & Team:** Overage charges apply automatically. You're never cut off.
- **Enterprise:** Custom limits — contact your account manager.

### Can I upgrade or downgrade at any time?

Yes. Upgrades take effect immediately with prorated billing. Downgrades take effect at the end of your current billing period.

### Is there a free trial for paid plans?

Yes — Pro and Team plans include a **14-day free trial** with full features. No credit card required to start.

### How does annual billing work?

Annual plans are billed once per year at a 20% discount. Pro annual: $276/year ($23/month). Team annual: $948/year ($79/month).

### Do you offer discounts for startups or open-source projects?

Yes! Contact us at sales@agentlens.ai for startup and open-source program details.

### What payment methods do you accept?

We accept all major credit cards via Stripe. Enterprise customers can pay by invoice.

### Is my data secure?

All data is encrypted in transit (TLS 1.3) and at rest (AES-256). Multi-tenant isolation is enforced via PostgreSQL Row-Level Security (RLS). See our [Tenant Isolation Guide](/docs/guide/tenant-isolation.md).

### Can I export my data?

Yes. All plans include data export in NDJSON format via the API or CLI. See the [API Reference](/docs/api/cloud-api-reference.md#data-export--import).

### Can I self-host instead?

Absolutely. AgentLens is open-source and can run entirely self-hosted with SQLite or PostgreSQL. The cloud offering adds managed infrastructure, team features, and billing. See the [Cloud Setup Guide](/docs/guide/cloud-setup.md) for details.
