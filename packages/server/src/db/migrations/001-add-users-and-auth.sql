-- E1-S3: Add users, refresh_tokens tables and extend api_keys
-- This migration is additive — safe to run on existing databases.

-- Users table
CREATE TABLE IF NOT EXISTS `users` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL DEFAULT 'default',
  `email` text NOT NULL,
  `display_name` text,
  `oidc_subject` text,
  `oidc_issuer` text,
  `role` text NOT NULL DEFAULT 'viewer',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `last_login_at` integer,
  `disabled_at` integer
);

CREATE INDEX IF NOT EXISTS `idx_users_tenant` ON `users` (`tenant_id`);
CREATE INDEX IF NOT EXISTS `idx_users_email` ON `users` (`email`);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_users_tenant_email` ON `users` (`tenant_id`, `email`);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_users_oidc` ON `users` (`oidc_issuer`, `oidc_subject`);

-- Refresh tokens table
CREATE TABLE IF NOT EXISTS `refresh_tokens` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`),
  `tenant_id` text NOT NULL DEFAULT 'default',
  `token_hash` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  `revoked_at` integer,
  `user_agent` text,
  `ip_address` text
);

CREATE INDEX IF NOT EXISTS `idx_refresh_tokens_user` ON `refresh_tokens` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_refresh_tokens_hash` ON `refresh_tokens` (`token_hash`);

-- Extend api_keys with created_by and role columns
ALTER TABLE `api_keys` ADD COLUMN `created_by` text REFERENCES `users`(`id`);
ALTER TABLE `api_keys` ADD COLUMN `role` text NOT NULL DEFAULT 'editor';

-- Backfill: API keys with scopes ['*'] get role = 'admin'
UPDATE `api_keys` SET `role` = 'admin' WHERE `scopes` = '["*"]';
