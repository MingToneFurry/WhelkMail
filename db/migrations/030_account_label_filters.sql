ALTER TABLE filters ADD COLUMN auto_label INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_filters_auto_account ON filters (account_id) WHERE auto_label = 1;

-- Turn every existing automatic account label into a real, editable filter.
INSERT INTO filters (id, account_id, name, from_pattern, to_pattern, subject_pattern, has_words, doesnt_have, has_attachment, label_ids_json, forward_to_json, enabled, created_at, auto_label)
SELECT
  lower(hex(randomblob(16))),
  a.id,
  COALESCE(l.name, 'Automatic label'),
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  0,
  '["' || a.incoming_label_id || '"]',
  '[]',
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  1
FROM accounts a
LEFT JOIN labels l ON l.id = a.incoming_label_id
WHERE a.incoming_label_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM filters f WHERE f.account_id = a.id AND f.auto_label = 1
  );
