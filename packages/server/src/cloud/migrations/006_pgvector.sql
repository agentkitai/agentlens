-- Migration 005: pgvector Extension & Embedding Tables (S-1.6)
-- Enables pgvector, converts embeddings table to use vector type,
-- adds HNSW index for semantic search, verifies RLS.

-- ═══════════════════════════════════════════
-- Enable pgvector extension
-- ═══════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;

-- ═══════════════════════════════════════════
-- Add vector column to embeddings table
-- The original embeddings table uses BYTEA for embedding data.
-- We add a native vector column for pgvector-powered similarity search.
-- ═══════════════════════════════════════════

-- Add the vector column (nullable initially for migration of existing rows)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'embeddings' AND column_name = 'embedding_vector'
  ) THEN
    -- We use vector(1536) as default dimension (OpenAI ada-002).
    -- For variable dimensions, we store as vector and validate at application layer.
    ALTER TABLE embeddings ADD COLUMN embedding_vector vector(1536);
  END IF;
END $$;

-- ═══════════════════════════════════════════
-- Create HNSW index for fast approximate nearest neighbor search
-- HNSW is preferred over IVFFlat: no training needed, better recall
-- ═══════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_embeddings_vector_hnsw
  ON embeddings USING hnsw (embedding_vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ═══════════════════════════════════════════
-- Composite index for org-scoped vector search
-- RLS filters by org_id first, then vector search within org
-- ═══════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_embeddings_org_source_type
  ON embeddings(org_id, source_type);

-- ═══════════════════════════════════════════
-- Ensure RLS is still active on embeddings
-- (Should already be from migration 003, but defensive)
-- ═══════════════════════════════════════════

ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE embeddings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS embeddings_tenant_isolation ON embeddings;
CREATE POLICY embeddings_tenant_isolation ON embeddings
  USING (org_id = current_setting('app.current_org')::uuid)
  WITH CHECK (org_id = current_setting('app.current_org')::uuid);
