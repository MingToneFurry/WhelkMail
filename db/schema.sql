CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'imap',
  imap_host TEXT,
  imap_port INTEGER,
  imap_security TEXT,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_security TEXT,
  username TEXT,
  auth_type TEXT NOT NULL DEFAULT 'password',
  secret_enc TEXT,
  access_token_enc TEXT,
  access_token_expires_at INTEGER,
  oauth_provider TEXT,
  sent_folder TEXT NOT NULL DEFAULT 'Sent',
  auto_saves_sent INTEGER NOT NULL DEFAULT 0,
  max_attachment_bytes INTEGER NOT NULL DEFAULT 15728640,
  storage_driver TEXT NOT NULL DEFAULT 'provider',
  relay_provider TEXT,
  relay_api_key_enc TEXT,
  relay_api_secret_enc TEXT,
  relay_domain TEXT,
  relay_region TEXT,
  drive_email TEXT,
  drive_folder_id TEXT,
  drive_refresh_token_enc TEXT,
  drive_access_token_enc TEXT,
  drive_token_expires_at INTEGER,
  signature TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT 'sent',
  message_id TEXT,
  from_name TEXT,
  from_email TEXT NOT NULL,
  to_json TEXT NOT NULL,
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT,
  sent_at TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  storage_driver TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'sent',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_account_folder ON messages (account_id, folder, sent_at DESC);

CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'blue',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_labels_account ON labels (account_id);

CREATE TABLE IF NOT EXISTS message_labels (
  message_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  label_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_message_labels_account ON message_labels (account_id, folder);
CREATE INDEX IF NOT EXISTS idx_message_labels_label ON message_labels (label_id);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS filters (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  from_pattern TEXT,
  to_pattern TEXT,
  subject_pattern TEXT,
  has_words TEXT,
  doesnt_have TEXT,
  has_attachment INTEGER NOT NULL DEFAULT 0,
  label_ids_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_filters_account ON filters (account_id);
