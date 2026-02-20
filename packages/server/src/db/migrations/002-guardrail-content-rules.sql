-- Feature 8: Add content-level guardrail fields
ALTER TABLE guardrail_rules ADD COLUMN direction TEXT DEFAULT 'both';
ALTER TABLE guardrail_rules ADD COLUMN tool_names TEXT;
ALTER TABLE guardrail_rules ADD COLUMN priority INTEGER DEFAULT 0;

-- Index for fast content rule lookups
CREATE INDEX IF NOT EXISTS idx_guardrail_rules_content
  ON guardrail_rules (tenant_id, enabled, priority DESC)
  WHERE condition_type IN ('pii_detection', 'secrets_detection', 'content_regex', 'toxicity_detection', 'prompt_injection');
