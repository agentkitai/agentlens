-- Migration 009: Deprecate lessons table
-- Lesson features moved to Lore SDK
-- Additive only — no DROP or RENAME to preserve data for migration

COMMENT ON TABLE lessons IS 'DEPRECATED: Use Lore SDK for lesson management. This table will be dropped in a future migration.';
