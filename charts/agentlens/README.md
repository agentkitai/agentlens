# AgentLens Helm Chart

Deploy [AgentLens](https://github.com/agentkitai/agentlens) — an observability platform for AI agents — on any Kubernetes cluster.

## Quick Start

```bash
# Batteries-included: deploys AgentLens + PostgreSQL (pgvector) + Redis
helm install agentlens ./charts/agentlens
```

## Deployment Patterns

### 1. SQLite Dev Mode

Single-replica with local storage — ideal for evaluation:

```bash
helm install agentlens ./charts/agentlens \
  --set config.storageBackend=sqlite \
  --set config.authDisabled=true \
  --set postgresql.enabled=false \
  --set redis.enabled=false \
  --set persistence.enabled=true \
  --set replicaCount=1
```

> **Note:** SQLite mode enforces `replicaCount=1`. Multiple replicas will fail validation.

### 2. Batteries-Included (Sub-Charts)

Default mode — deploys PostgreSQL with pgvector and Redis as sub-charts:

```bash
helm install agentlens ./charts/agentlens
```

### 3. External Infrastructure

Bring your own PostgreSQL and Redis:

```bash
helm install agentlens ./charts/agentlens \
  --set postgresql.enabled=false \
  --set externalDatabase.enabled=true \
  --set externalDatabase.existingSecret=my-db-secret \
  --set redis.enabled=false \
  --set externalRedis.enabled=true \
  --set externalRedis.existingSecret=my-redis-secret
```

### 4. Production HA

Use the production values overlay:

```bash
helm install agentlens ./charts/agentlens -f charts/agentlens/values-prod.yaml
```

This enables: 3 replicas, HPA, PDB, Ingress with cert-manager, topology spread constraints, and increased resources.

## Configuration

### Image

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of replicas | `1` |
| `image.repository` | Container image | `ghcr.io/agentkitai/agentlens` |
| `image.tag` | Image tag | `""` (uses `appVersion`) |
| `image.pullPolicy` | Pull policy | `IfNotPresent` |
| `imagePullSecrets` | Image pull secrets | `[]` |

### Application Config

| Parameter | Description | Default |
|-----------|-------------|---------|
| `config.storageBackend` | `postgres` or `sqlite` | `postgres` |
| `config.port` | Server port | `3000` |
| `config.authDisabled` | Disable auth (dev only) | `false` |
| `config.retentionDays` | Data retention days | `90` |
| `config.otlpRateLimit` | OTLP rate limit | `1000` |
| `config.otlpAuthRequired` | Require OTLP auth | `false` |
| `config.corsOrigins` | CORS origins (comma-separated) | `""` |
| `config.meshEnabled` | Enable mesh integration | `false` |
| `config.meshUrl` | Mesh URL | `""` |
| `config.loreEnabled` | Enable Lore integration | `false` |
| `config.loreMode` | Lore mode (`local`/`remote`) | `remote` |
| `config.loreApiUrl` | Lore API URL | `""` |
| `config.loreDbPath` | Lore DB path | `""` |
| `config.extraEnv` | Additional env vars | `{}` |

### Secrets

| Parameter | Description | Default |
|-----------|-------------|---------|
| `secrets.create` | Create Secret resource | `true` |
| `secrets.existingSecret` | Use existing Secret | `""` |
| `secrets.jwtSecret` | JWT secret | `""` |
| `secrets.adminApiKey` | Admin API key | `""` |
| `secrets.otlpAuthToken` | OTLP auth token | `""` |
| `secrets.stripeSecretKey` | Stripe secret key | `""` |
| `secrets.stripeWebhookSecret` | Stripe webhook secret | `""` |
| `secrets.loreApiKey` | Lore API key | `""` |
| `secrets.auditSigningKey` | Audit signing key | `""` |

### External Database

| Parameter | Description | Default |
|-----------|-------------|---------|
| `externalDatabase.enabled` | Use external DB | `false` |
| `externalDatabase.url` | DATABASE_URL | `""` |
| `externalDatabase.existingSecret` | Secret with DB URL | `""` |
| `externalDatabase.secretKey` | Key in secret | `database-url` |

### External Redis

| Parameter | Description | Default |
|-----------|-------------|---------|
| `externalRedis.enabled` | Use external Redis | `false` |
| `externalRedis.url` | REDIS_URL | `""` |
| `externalRedis.existingSecret` | Secret with Redis URL | `""` |
| `externalRedis.secretKey` | Key in secret | `redis-url` |

### PostgreSQL Sub-Chart (Bitnami)

| Parameter | Description | Default |
|-----------|-------------|---------|
| `postgresql.enabled` | Deploy PostgreSQL | `true` |
| `postgresql.image.repository` | PostgreSQL image | `pgvector/pgvector` |
| `postgresql.image.tag` | Image tag | `pg16` |
| `postgresql.auth.database` | Database name | `agentlens` |
| `postgresql.auth.username` | Username | `agentlens` |
| `postgresql.auth.password` | Password (auto-generated if empty) | `""` |
| `postgresql.primary.persistence.size` | PVC size | `20Gi` |

### Redis Sub-Chart (Bitnami)

| Parameter | Description | Default |
|-----------|-------------|---------|
| `redis.enabled` | Deploy Redis | `true` |
| `redis.architecture` | Architecture | `standalone` |
| `redis.auth.enabled` | Enable auth | `false` |
| `redis.master.persistence.size` | PVC size | `2Gi` |

### Service

| Parameter | Description | Default |
|-----------|-------------|---------|
| `service.type` | Service type | `ClusterIP` |
| `service.port` | Service port | `80` |
| `service.targetPort` | Target port | `3000` |

### Ingress

| Parameter | Description | Default |
|-----------|-------------|---------|
| `ingress.enabled` | Enable Ingress | `false` |
| `ingress.className` | Ingress class | `""` |
| `ingress.annotations` | Annotations | `{}` |
| `ingress.hosts` | Host rules | `[{host: agentlens.example.com, paths: [{path: /, pathType: Prefix}]}]` |
| `ingress.tls` | TLS config | `[]` |

### Probes

| Parameter | Description | Default |
|-----------|-------------|---------|
| `probes.liveness` | Liveness probe config | HTTP GET `/api/stats` |
| `probes.readiness` | Readiness probe config | HTTP GET `/api/stats` |
| `probes.startup` | Startup probe config | HTTP GET `/api/stats` |

### Resources & Scaling

| Parameter | Description | Default |
|-----------|-------------|---------|
| `resources.requests.cpu` | CPU request | `100m` |
| `resources.requests.memory` | Memory request | `256Mi` |
| `resources.limits.cpu` | CPU limit | `1` |
| `resources.limits.memory` | Memory limit | `512Mi` |
| `autoscaling.enabled` | Enable HPA | `false` |
| `autoscaling.minReplicas` | Min replicas | `2` |
| `autoscaling.maxReplicas` | Max replicas | `10` |
| `autoscaling.targetCPUUtilizationPercentage` | CPU target | `70` |
| `autoscaling.targetMemoryUtilizationPercentage` | Memory target | `80` |
| `podDisruptionBudget.enabled` | Enable PDB | `false` |
| `podDisruptionBudget.minAvailable` | Min available | `1` |

### Persistence (SQLite Mode)

| Parameter | Description | Default |
|-----------|-------------|---------|
| `persistence.enabled` | Enable PVC | `false` |
| `persistence.size` | PVC size | `10Gi` |
| `persistence.storageClass` | Storage class | `""` |
| `persistence.accessModes` | Access modes | `[ReadWriteOnce]` |
| `persistence.existingClaim` | Existing PVC name | `""` |

### Migration Job

| Parameter | Description | Default |
|-----------|-------------|---------|
| `migration.enabled` | Run migrations as Helm hook | `true` |
| `migration.backoffLimit` | Job retries | `3` |
| `migration.ttlSecondsAfterFinished` | Job TTL | `600` |
| `migration.resources` | Job resources | `cpu: 100m-500m, mem: 256Mi-512Mi` |

### ServiceAccount & Pod Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `serviceAccount.create` | Create ServiceAccount | `true` |
| `serviceAccount.name` | SA name | `""` |
| `serviceAccount.annotations` | SA annotations | `{}` |
| `podAnnotations` | Pod annotations | `{}` |
| `podLabels` | Pod labels | `{}` |
| `podSecurityContext.fsGroup` | FS group | `1000` |
| `securityContext.runAsNonRoot` | Run as non-root | `true` |
| `securityContext.runAsUser` | Run as user | `1000` |
| `nodeSelector` | Node selector | `{}` |
| `tolerations` | Tolerations | `[]` |
| `affinity` | Affinity rules | `{}` |
| `topologySpreadConstraints` | Topology spread | `[]` |

## Upgrades

The chart includes a **pre-install/pre-upgrade migration Job** (when `migration.enabled=true` and `storageBackend=postgres`). Migrations run before new application pods are rolled out, ensuring schema compatibility.

- Migrations are **idempotent** (Drizzle ORM tracks applied migrations).
- Failed migration Jobs are preserved for debugging; successful ones are cleaned up.
- When using the PostgreSQL sub-chart, an init container waits for the database to be ready.
- For SQLite mode, migrations run in-process on application startup — no hook is needed.

## pgvector Notes

The chart configures the PostgreSQL sub-chart to use the `pgvector/pgvector:pg16` image, which includes the vector extension. Additionally:

- An `initdb` script runs `CREATE EXTENSION IF NOT EXISTS vector` on first database initialization.
- The migration Job also ensures the extension exists before running schema migrations.

If you use an external PostgreSQL database, ensure pgvector is installed and the `vector` extension is available.

## Redis Optionality

Redis is used for event ingestion queuing via Redis Streams. However, it is **fully optional**:

- When `REDIS_URL` is not set, AgentLens falls back to an in-memory event queue.
- The in-memory fallback is suitable for **single-replica** deployments.
- For **multi-replica production** deployments, Redis is recommended for reliable event queuing across instances.

To disable Redis entirely:
```bash
--set redis.enabled=false
```

## Security Recommendations

- Use `secrets.existingSecret` with [external-secrets-operator](https://external-secrets.io/) or [sealed-secrets](https://sealed-secrets.netlify.app/) instead of passing secrets via `--set`.
- Enable OTLP authentication in production (`config.otlpAuthRequired=true`).
- Consider adding NetworkPolicy resources to restrict traffic:
  - Ingress: only from Ingress controller to port 3000
  - Egress: only to PostgreSQL (5432), Redis (6379), and DNS

## Installing from OCI Registry

```bash
helm install agentlens oci://ghcr.io/agentkitai/charts/agentlens --version 0.1.0
```
