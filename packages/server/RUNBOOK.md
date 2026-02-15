# AgentLens Runbook

## PostgreSQL Tuning Recommendations

The following settings are recommended for typical AgentLens deployments. Adjust based on your available RAM and workload.

### Memory Settings

| Parameter | Small (2-4 GB RAM) | Medium (8-16 GB RAM) | Large (32+ GB RAM) | Notes |
|---|---|---|---|---|
| `shared_buffers` | `512MB` | `2GB` | `8GB` | ~25% of total RAM |
| `effective_cache_size` | `1.5GB` | `6GB` | `24GB` | ~75% of total RAM |
| `work_mem` | `16MB` | `64MB` | `128MB` | Per-sort/hash operation; be conservative with many concurrent connections |
| `maintenance_work_mem` | `256MB` | `512MB` | `1GB` | Used for VACUUM, CREATE INDEX, etc. |

### Additional Recommendations

```ini
# Write-ahead log — AgentLens is write-heavy (event ingestion)
wal_buffers = 64MB
checkpoint_completion_target = 0.9
max_wal_size = 2GB

# Planner — tell Postgres about SSD storage
random_page_cost = 1.1
effective_io_concurrency = 200

# Parallelism (medium/large deployments)
max_parallel_workers_per_gather = 2
max_parallel_workers = 4
```

### Connection Pooling

AgentLens benefits from a connection pooler (e.g., PgBouncer) in front of PostgreSQL, especially with `work_mem` set higher. Recommended PgBouncer mode: **transaction**.

### Index Maintenance

The indexes created by migration `0001_indexes.sql` use `CREATE INDEX CONCURRENTLY` to avoid locking tables during creation. After heavy bulk-delete operations, run `REINDEX CONCURRENTLY` to reclaim space:

```sql
REINDEX INDEX CONCURRENTLY idx_events_timestamp_brin;
```

Monitor index bloat with:

```sql
SELECT schemaname, indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;
```
