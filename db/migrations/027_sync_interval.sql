-- How often the automatic check runs for this account, in minutes.
--
-- The cron worker wakes up every minute and each account is synced only when its
-- interval has elapsed, so the value is honoured rather than rounded up to the
-- trigger. Notification, forwarding and cleanup work ignores it.
ALTER TABLE accounts ADD COLUMN sync_interval_minutes INTEGER NOT NULL DEFAULT 5;
