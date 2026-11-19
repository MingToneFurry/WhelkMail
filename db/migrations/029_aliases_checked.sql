-- Marks the messages whose forwarding headers were already read.
--
-- aliases_json is '[]' both for a message that has no forwarding header and for
-- one mirrored before the column existed, so the sync needs a flag to backfill
-- the second kind exactly once.
ALTER TABLE imap_messages ADD COLUMN aliases_checked INTEGER NOT NULL DEFAULT 0;

-- Rows that already carry addresses were computed at ingest: nothing to redo.
UPDATE imap_messages SET aliases_checked = 1 WHERE aliases_json <> '[]';
