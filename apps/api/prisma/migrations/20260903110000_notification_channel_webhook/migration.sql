-- Add WEBHOOK to the notification channel enum (Phase 2D.2C). Isolated migration so the value commits
-- before any later migration/data uses it.
ALTER TYPE "NotificationChannel" ADD VALUE 'WEBHOOK';
