-- Vacation responder. The shared configuration lives in app_settings
-- (auto_reply_mode / auto_reply_enabled / auto_reply_subject / auto_reply_body);
-- these account columns are used when the user picks the per-account mode.
ALTER TABLE accounts ADD COLUMN auto_reply_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN auto_reply_subject TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN auto_reply_body TEXT NOT NULL DEFAULT '';

-- One row per replied message, and a sender index for the cooldown check.
-- The unique key makes a retried sync chunk harmless.
CREATE TABLE IF NOT EXISTS auto_reply_log (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_reply_log_message ON auto_reply_log (account_id, message_id);
CREATE INDEX IF NOT EXISTS idx_auto_reply_log_sender ON auto_reply_log (account_id, sender_email, created_at DESC);
