CREATE TABLE "agent_sharing_config" (
	"tenant_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "agent_sharing_config_tenant_id_agent_id_pk" PRIMARY KEY("tenant_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"first_seen_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	"session_count" integer DEFAULT 0 NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"model_override" text,
	"paused_at" text,
	"pause_reason" text,
	CONSTRAINT "agents_id_tenant_id_pk" PRIMARY KEY("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "alert_history" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"triggered_at" text NOT NULL,
	"resolved_at" text,
	"current_value" double precision NOT NULL,
	"threshold" double precision NOT NULL,
	"message" text NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"condition" text NOT NULL,
	"threshold" double precision NOT NULL,
	"window_minutes" integer NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notify_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anonymous_id_map" (
	"tenant_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"anonymous_agent_id" text NOT NULL,
	"valid_from" text NOT NULL,
	"valid_until" text NOT NULL,
	CONSTRAINT "anonymous_id_map_tenant_id_agent_id_valid_from_pk" PRIMARY KEY("tenant_id","agent_id","valid_from")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"key_hash" text NOT NULL,
	"name" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_at" integer NOT NULL,
	"last_used_at" integer,
	"revoked_at" integer,
	"rate_limit" integer,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"created_by" text,
	"role" text DEFAULT 'editor' NOT NULL,
	"rotated_at" integer,
	"expires_at" integer
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"timestamp" text NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "capability_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"task_type" text NOT NULL,
	"custom_type" text,
	"input_schema" jsonb NOT NULL,
	"output_schema" jsonb NOT NULL,
	"quality_metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"estimated_latency_ms" integer,
	"estimated_cost_usd" double precision,
	"max_input_bytes" integer,
	"scope" text DEFAULT 'internal' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"accept_delegations" boolean DEFAULT false NOT NULL,
	"inbound_rate_limit" integer DEFAULT 10 NOT NULL,
	"outbound_rate_limit" integer DEFAULT 20 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delegation_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"direction" text NOT NULL,
	"agent_id" text NOT NULL,
	"anonymous_target_id" text,
	"anonymous_source_id" text,
	"task_type" text NOT NULL,
	"status" text NOT NULL,
	"request_size_bytes" integer,
	"response_size_bytes" integer,
	"execution_time_ms" integer,
	"cost_usd" double precision,
	"created_at" text NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "deny_list_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"pattern" text NOT NULL,
	"is_regex" boolean DEFAULT false NOT NULL,
	"reason" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_config" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"min_trust_threshold" integer DEFAULT 60 NOT NULL,
	"delegation_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"text_content" text NOT NULL,
	"embedding" "bytea" NOT NULL,
	"embedding_model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"timestamp" text NOT NULL,
	"session_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"event_type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"payload" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"agent_id" text,
	"category" text DEFAULT 'general' NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"importance" text DEFAULT 'normal' NOT NULL,
	"source_session_id" text,
	"source_event_id" text,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"archived_at" text,
	CONSTRAINT "lessons_id_tenant_id_pk" PRIMARY KEY("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" integer NOT NULL,
	"created_at" integer NOT NULL,
	"revoked_at" integer,
	"user_agent" text,
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "session_summaries" (
	"session_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"summary" text NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_sequence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_summary" text,
	"outcome" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "session_summaries_session_id_tenant_id_pk" PRIMARY KEY("session_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text NOT NULL,
	"agent_id" text NOT NULL,
	"agent_name" text,
	"started_at" text NOT NULL,
	"ended_at" text,
	"status" text DEFAULT 'active' NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" double precision DEFAULT 0 NOT NULL,
	"llm_call_count" integer DEFAULT 0 NOT NULL,
	"total_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	CONSTRAINT "sessions_id_tenant_id_pk" PRIMARY KEY("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "sharing_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"event_type" text NOT NULL,
	"lesson_id" text,
	"anonymous_lesson_id" text,
	"lesson_hash" text,
	"redaction_findings" text,
	"query_text" text,
	"result_ids" text,
	"pool_endpoint" text,
	"initiated_by" text,
	"timestamp" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sharing_config" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"human_review_enabled" boolean DEFAULT false NOT NULL,
	"pool_endpoint" text,
	"anonymous_contributor_id" text,
	"purge_token" text,
	"rate_limit_per_hour" integer DEFAULT 50 NOT NULL,
	"volume_alert_threshold" integer DEFAULT 100 NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sharing_review_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"original_title" text NOT NULL,
	"original_content" text NOT NULL,
	"redacted_title" text NOT NULL,
	"redacted_content" text NOT NULL,
	"redaction_findings" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" text,
	"created_at" text NOT NULL,
	"expires_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"oidc_subject" text,
	"oidc_issuer" text,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL,
	"last_login_at" integer,
	"disabled_at" integer
);
--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agents_tenant_id" ON "agents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_alert_history_rule_id" ON "alert_history" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "idx_anon_map_anon_id" ON "anonymous_id_map" USING btree ("anonymous_agent_id");--> statement-breakpoint
CREATE INDEX "idx_api_keys_hash" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "idx_audit_log_tenant_ts" ON "audit_log" USING btree ("tenant_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_audit_log_action" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_capability_tenant_agent" ON "capability_registry" USING btree ("tenant_id","agent_id");--> statement-breakpoint
CREATE INDEX "idx_capability_task_type" ON "capability_registry" USING btree ("tenant_id","task_type");--> statement-breakpoint
CREATE INDEX "idx_delegation_tenant_ts" ON "delegation_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_delegation_agent" ON "delegation_log" USING btree ("tenant_id","agent_id");--> statement-breakpoint
CREATE INDEX "idx_delegation_status" ON "delegation_log" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_deny_list_rules_tenant" ON "deny_list_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_embeddings_tenant" ON "embeddings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_embeddings_source" ON "embeddings" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "idx_embeddings_content_hash" ON "embeddings" USING btree ("tenant_id","content_hash");--> statement-breakpoint
CREATE INDEX "idx_embeddings_tenant_source_time" ON "embeddings" USING btree ("tenant_id","source_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_events_timestamp" ON "events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_events_session_id" ON "events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_events_agent_id" ON "events" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_events_type" ON "events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_events_session_ts" ON "events" USING btree ("session_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_events_agent_type_ts" ON "events" USING btree ("agent_id","event_type","timestamp");--> statement-breakpoint
CREATE INDEX "idx_events_tenant_id" ON "events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_events_tenant_session" ON "events" USING btree ("tenant_id","session_id");--> statement-breakpoint
CREATE INDEX "idx_events_tenant_agent_ts" ON "events" USING btree ("tenant_id","agent_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_lessons_tenant" ON "lessons" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_lessons_tenant_agent" ON "lessons" USING btree ("tenant_id","agent_id");--> statement-breakpoint
CREATE INDEX "idx_lessons_tenant_category" ON "lessons" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "idx_lessons_tenant_importance" ON "lessons" USING btree ("tenant_id","importance");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_hash" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_session_summaries_tenant" ON "session_summaries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_agent_id" ON "sessions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_started_at" ON "sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_status" ON "sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_sessions_tenant_id" ON "sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_tenant_agent" ON "sessions" USING btree ("tenant_id","agent_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_tenant_started" ON "sessions" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_sharing_audit_tenant_ts" ON "sharing_audit_log" USING btree ("tenant_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_sharing_audit_type" ON "sharing_audit_log" USING btree ("tenant_id","event_type");--> statement-breakpoint
CREATE INDEX "idx_review_queue_tenant_status" ON "sharing_review_queue" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_users_tenant" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_tenant_email" ON "users" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_oidc" ON "users" USING btree ("oidc_issuer","oidc_subject");