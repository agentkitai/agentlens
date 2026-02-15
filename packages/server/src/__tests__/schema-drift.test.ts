/**
 * Schema-drift detection: ensures SQLite and Postgres schemas define
 * the same logical tables with the same column names.
 */
import { describe, it, expect } from 'vitest';
import * as sqliteSchema from '../db/schema.sqlite.js';
import * as pgSchema from '../db/schema.postgres.js';
import { getTableName, getTableColumns } from 'drizzle-orm';

/** Extract all table exports from a schema module */
function extractTables(schema: Record<string, unknown>) {
  const tables: Record<string, Record<string, unknown>> = {};
  for (const [exportName, value] of Object.entries(schema)) {
    if (value && typeof value === 'object' && 'getSQL' in (value as any).__proto__?.constructor) {
      // duck-type: drizzle tables have Symbol.for('drizzle:Name') or getTableName works
    }
    try {
      const name = getTableName(value as any);
      if (name) {
        tables[name] = value as any;
      }
    } catch {
      // not a table, skip
    }
  }
  return tables;
}

describe('Schema drift detection', () => {
  const sqliteTables = extractTables(sqliteSchema as any);
  const pgTables = extractTables(pgSchema as any);

  it('should have the same set of table names', () => {
    const sqliteNames = Object.keys(sqliteTables).sort();
    const pgNames = Object.keys(pgTables).sort();
    
    const onlySqlite = sqliteNames.filter(n => !pgNames.includes(n));
    const onlyPg = pgNames.filter(n => !sqliteNames.includes(n));
    
    expect(onlySqlite, `Tables only in SQLite: ${onlySqlite.join(', ')}`).toEqual([]);
    expect(onlyPg, `Tables only in Postgres: ${onlyPg.join(', ')}`).toEqual([]);
  });

  // Generate per-table column comparison tests
  const allTableNames = [...new Set([
    ...Object.keys(sqliteTables),
    ...Object.keys(pgTables),
  ])].sort();

  for (const tableName of allTableNames) {
    it(`table "${tableName}" should have the same columns in both dialects`, () => {
      const sqliteTable = sqliteTables[tableName];
      const pgTable = pgTables[tableName];
      
      if (!sqliteTable || !pgTable) {
        // Already caught by the table names test above
        return;
      }

      const sqliteCols = Object.keys(getTableColumns(sqliteTable as any)).sort();
      const pgCols = Object.keys(getTableColumns(pgTable as any)).sort();

      const onlySqlite = sqliteCols.filter(c => !pgCols.includes(c));
      const onlyPg = pgCols.filter(c => !sqliteCols.includes(c));

      expect(onlySqlite, `Columns only in SQLite "${tableName}": ${onlySqlite.join(', ')}`).toEqual([]);
      expect(onlyPg, `Columns only in Postgres "${tableName}": ${onlyPg.join(', ')}`).toEqual([]);
    });
  }
});
