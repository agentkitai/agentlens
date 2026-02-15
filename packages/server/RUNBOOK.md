# Server Runbook

## PostgreSQL Migrations (Drizzle Kit)

### Generating a new migration

After modifying `src/db/schema.postgres.ts`:

```bash
pnpm --filter @agentlensai/server db:generate
```

This creates a new SQL file in `src/db/drizzle/` and updates the journal.

### Applying migrations

Migrations run **automatically on server startup** (Postgres dialect only) via
`runPostgresMigrations()`. You can also apply manually:

```bash
DATABASE_URL=postgresql://... pnpm --filter @agentlensai/server db:migrate
```

### Rolling back a failed migration

Drizzle Kit does not generate automatic rollback scripts. To recover:

1. **Identify the failed migration** in `src/db/drizzle/` (check the `__drizzle_migrations` table for the latest entry).

2. **Write a reverse SQL script** undoing the DDL changes (DROP columns/tables/indexes added by the migration).

3. **Apply it manually:**
   ```bash
   psql "$DATABASE_URL" -f rollback.sql
   ```

4. **Remove the migration journal entry:**
   ```sql
   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<migration_hash>';
   ```

5. **Fix the schema file**, then regenerate:
   ```bash
   pnpm --filter @agentlensai/server db:generate
   ```

### SQLite migrations

SQLite continues to use the imperative `runMigrations()` function in
`migrate.sqlite.ts`. It runs on startup and is fully idempotent (CREATE IF NOT EXISTS + PRAGMA checks).

No changes are needed for existing SQLite deployments.
