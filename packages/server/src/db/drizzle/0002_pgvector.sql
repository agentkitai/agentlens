-- Migration 0002: Enable pgvector for self-hosted deployments
-- Adds native vector column + HNSW index for embedding similarity search

-- Enable the pgvector extension (ships with pgvector/pgvector:pg16 Docker image)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add vector column alongside existing bytea column
-- Using 1536 dimensions (OpenAI text-embedding-ada-002 / text-embedding-3-small default)
ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS embedding_vector vector(1536);

-- HNSW index for approximate nearest neighbor search (cosine distance)
-- m=16, ef_construction=64 are good defaults for <1M vectors
CREATE INDEX IF NOT EXISTS idx_embeddings_vector_hnsw
  ON embeddings USING hnsw (embedding_vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Composite index for tenant-scoped vector queries
CREATE INDEX IF NOT EXISTS idx_embeddings_tenant_source_type_vector
  ON embeddings (tenant_id, source_type);
