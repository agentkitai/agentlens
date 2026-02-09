-- ═══════════════════════════════════════════
-- S-2.1 / S-2.2: Auth token storage
-- Email verification and password reset tokens
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS _email_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('verification', 'reset')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_tokens_hash ON _email_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON _email_tokens(user_id, type);
