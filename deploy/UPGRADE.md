# AgentLens Upgrade Runbook

## General Upgrade Procedure

1. **Back up the database** before every upgrade:
   ```bash
   # PostgreSQL
   pg_dump -U agentlens agentlens > backup-$(date +%Y%m%d).sql

   # SQLite
   cp agentlens.db agentlens.db.bak
   ```

2. **Pull the new image** (or rebuild):
   ```bash
   docker compose pull agentlens
   # or
   docker compose build agentlens
   ```

3. **Apply the upgrade**:
   ```bash
   docker compose up -d
   ```

4. **Verify health**:
   ```bash
   curl http://localhost:3000/api/stats
   curl http://localhost:3000/api/version
   ```

---

## Version-Specific Migration Notes

### v0.9.0 -> v0.10.0

- **API versioning**: All responses now include `X-API-Version: v1` header. Clients should start sending `X-API-Version: v1` header for forward compatibility.
- **New endpoints**: `GET /api/version`, `GET /api/agents/:id/optimize`, `GET /api/optimize/summary`.
- **Helm chart**: If using the deploy/helm chart, update `Chart.yaml` appVersion and re-deploy.
- **No breaking changes** to existing endpoints.

### v0.8.0 -> v0.9.0

- **PostgreSQL storage backend** is now the recommended default. Set `STORAGE_BACKEND=postgres`.
- **Guardrails engine** added. New tables are auto-migrated on startup.
- **Cost budgets & anomaly detection** added. No manual migration needed.
- **Auth changes**: `JWT_SECRET` is now required in production (`AUTH_DISABLED=false`).

### v0.7.0 -> v0.8.0

- **Embedding worker** runs by default. Set `DISABLE_EMBEDDINGS=true` to opt out.
- **Notification channels** table added (auto-migrated).
- **Alert engine** starts automatically. No configuration needed.

---

## Rollback Procedure

1. **Stop the current version**:
   ```bash
   docker compose down
   ```

2. **Restore the database backup**:
   ```bash
   psql -U agentlens agentlens < backup-YYYYMMDD.sql
   ```

3. **Deploy the previous version**:
   ```bash
   docker compose up -d
   ```

---

## Helm Upgrade

```bash
helm upgrade agentlens deploy/helm/agentlens \
  --namespace agentlens \
  --values my-values.yaml \
  --wait
```

To roll back:
```bash
helm rollback agentlens 1
```
