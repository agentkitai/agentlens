/**
 * Vitest globalSetup for the cloud-postgres suite (#256).
 *
 * The cloud tests share the CI Postgres with the postgres-integration step, which
 * leaves OSS tables behind — notably an `orgs` table without the columns the cloud
 * migrations index (e.g. stripe_customer_id). Several cloud tests runMigrations
 * with CREATE TABLE IF NOT EXISTS, so that stale `orgs` is kept and the follow-up
 * CREATE INDEX fails. Dropping every public table once, before the suite, gives the
 * cloud migrations a clean slate. No-op when DATABASE_URL is unset (local runs).
 */
export default async function resetDb(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  const pg = await import('pg');
  const pool = new pg.default.Pool({ connectionString: dbUrl });
  try {
    await pool.query(`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
  } finally {
    await pool.end();
  }
}
