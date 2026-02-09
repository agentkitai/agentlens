-- Migration 007: Add missing columns to invoices table (F-08)
-- Adds billing_interval and line_items columns referenced by invoice-service.ts

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_interval TEXT NOT NULL DEFAULT 'monthly'
  CHECK (billing_interval IN ('monthly', 'annual'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS line_items JSONB NOT NULL DEFAULT '[]';
