CREATE TABLE `agent_sharing_config` (
	`tenant_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`categories` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `agent_id`)
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`session_count` integer DEFAULT 0 NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`model_override` text,
	`paused_at` text,
	`pause_reason` text,
	PRIMARY KEY(`id`, `tenant_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_agents_tenant_id` ON `agents` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `alert_history` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`triggered_at` text NOT NULL,
	`resolved_at` text,
	`current_value` real NOT NULL,
	`threshold` real NOT NULL,
	`message` text NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `alert_rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_alert_history_rule_id` ON `alert_history` (`rule_id`);--> statement-breakpoint
CREATE TABLE `alert_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`condition` text NOT NULL,
	`threshold` real NOT NULL,
	`window_minutes` integer NOT NULL,
	`scope` text DEFAULT '{}' NOT NULL,
	`notify_channels` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `anonymous_id_map` (
	`tenant_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`anonymous_agent_id` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_until` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `agent_id`, `valid_from`)
);
--> statement-breakpoint
CREATE INDEX `idx_anon_map_anon_id` ON `anonymous_id_map` (`anonymous_agent_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`key_hash` text NOT NULL,
	`name` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`rate_limit` integer,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`created_by` text,
	`role` text DEFAULT 'editor' NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_api_keys_hash` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `capability_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`task_type` text NOT NULL,
	`custom_type` text,
	`input_schema` text NOT NULL,
	`output_schema` text NOT NULL,
	`quality_metrics` text DEFAULT '{}' NOT NULL,
	`estimated_latency_ms` integer,
	`estimated_cost_usd` real,
	`max_input_bytes` integer,
	`scope` text DEFAULT 'internal' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`accept_delegations` integer DEFAULT false NOT NULL,
	`inbound_rate_limit` integer DEFAULT 10 NOT NULL,
	`outbound_rate_limit` integer DEFAULT 20 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_capability_tenant_agent` ON `capability_registry` (`tenant_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_capability_task_type` ON `capability_registry` (`tenant_id`,`task_type`);--> statement-breakpoint
CREATE TABLE `delegation_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`direction` text NOT NULL,
	`agent_id` text NOT NULL,
	`anonymous_target_id` text,
	`anonymous_source_id` text,
	`task_type` text NOT NULL,
	`status` text NOT NULL,
	`request_size_bytes` integer,
	`response_size_bytes` integer,
	`execution_time_ms` integer,
	`cost_usd` real,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_delegation_tenant_ts` ON `delegation_log` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_delegation_agent` ON `delegation_log` (`tenant_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_delegation_status` ON `delegation_log` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `deny_list_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`pattern` text NOT NULL,
	`is_regex` integer DEFAULT false NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_deny_list_rules_tenant` ON `deny_list_rules` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `discovery_config` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`min_trust_threshold` integer DEFAULT 60 NOT NULL,
	`delegation_enabled` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`text_content` text NOT NULL,
	`embedding` blob NOT NULL,
	`embedding_model` text NOT NULL,
	`dimensions` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_embeddings_tenant` ON `embeddings` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_embeddings_source` ON `embeddings` (`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `idx_embeddings_content_hash` ON `embeddings` (`tenant_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_embeddings_tenant_source_time` ON `embeddings` (`tenant_id`,`source_type`,`created_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` text NOT NULL,
	`session_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`event_type` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`payload` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`prev_hash` text,
	`hash` text NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_timestamp` ON `events` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_events_session_id` ON `events` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_events_agent_id` ON `events` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_events_type` ON `events` (`event_type`);--> statement-breakpoint
CREATE INDEX `idx_events_session_ts` ON `events` (`session_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_events_agent_type_ts` ON `events` (`agent_id`,`event_type`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_events_tenant_id` ON `events` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_events_tenant_session` ON `events` (`tenant_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `idx_events_tenant_agent_ts` ON `events` (`tenant_id`,`agent_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`agent_id` text,
	`category` text DEFAULT 'general' NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`context` text DEFAULT '{}' NOT NULL,
	`importance` text DEFAULT 'normal' NOT NULL,
	`source_session_id` text,
	`source_event_id` text,
	`access_count` integer DEFAULT 0 NOT NULL,
	`last_accessed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	PRIMARY KEY(`id`, `tenant_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_lessons_tenant` ON `lessons` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_lessons_tenant_agent` ON `lessons` (`tenant_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_lessons_tenant_category` ON `lessons` (`tenant_id`,`category`);--> statement-breakpoint
CREATE INDEX `idx_lessons_tenant_importance` ON `lessons` (`tenant_id`,`importance`);--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	`user_agent` text,
	`ip_address` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_refresh_tokens_user` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_refresh_tokens_hash` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `session_summaries` (
	`session_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`summary` text NOT NULL,
	`topics` text DEFAULT '[]' NOT NULL,
	`tool_sequence` text DEFAULT '[]' NOT NULL,
	`error_summary` text,
	`outcome` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `tenant_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_session_summaries_tenant` ON `session_summaries` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text NOT NULL,
	`agent_id` text NOT NULL,
	`agent_name` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`event_count` integer DEFAULT 0 NOT NULL,
	`tool_call_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`total_cost_usd` real DEFAULT 0 NOT NULL,
	`llm_call_count` integer DEFAULT 0 NOT NULL,
	`total_input_tokens` integer DEFAULT 0 NOT NULL,
	`total_output_tokens` integer DEFAULT 0 NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	PRIMARY KEY(`id`, `tenant_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_agent_id` ON `sessions` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_started_at` ON `sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_status` ON `sessions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sessions_tenant_id` ON `sessions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_tenant_agent` ON `sessions` (`tenant_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_tenant_started` ON `sessions` (`tenant_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `sharing_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`event_type` text NOT NULL,
	`lesson_id` text,
	`anonymous_lesson_id` text,
	`lesson_hash` text,
	`redaction_findings` text,
	`query_text` text,
	`result_ids` text,
	`pool_endpoint` text,
	`initiated_by` text,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sharing_audit_tenant_ts` ON `sharing_audit_log` (`tenant_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_sharing_audit_type` ON `sharing_audit_log` (`tenant_id`,`event_type`);--> statement-breakpoint
CREATE TABLE `sharing_config` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`human_review_enabled` integer DEFAULT false NOT NULL,
	`pool_endpoint` text,
	`anonymous_contributor_id` text,
	`purge_token` text,
	`rate_limit_per_hour` integer DEFAULT 50 NOT NULL,
	`volume_alert_threshold` integer DEFAULT 100 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sharing_review_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`original_title` text NOT NULL,
	`original_content` text NOT NULL,
	`redacted_title` text NOT NULL,
	`redacted_content` text NOT NULL,
	`redaction_findings` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_review_queue_tenant_status` ON `sharing_review_queue` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`oidc_subject` text,
	`oidc_issuer` text,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_login_at` integer,
	`disabled_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_users_tenant` ON `users` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_tenant_email` ON `users` (`tenant_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_oidc` ON `users` (`oidc_issuer`,`oidc_subject`);