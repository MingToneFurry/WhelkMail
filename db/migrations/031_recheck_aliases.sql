-- The header fetch used to request only From/To/Cc/Subject/Date/Message-ID/
-- In-Reply-To/References, so `aliasAddresses()` never saw Delivered-To,
-- X-Original-To, X-Forwarded-For or `Received ... for`. Every row was stored
-- with `aliases_json = '[]'` and marked as already checked, so the backfill
-- skipped it forever and a filter on "to" kept missing forwarded mail.
--
-- The fetch now includes those headers. Mark the rows that never carried an
-- alias for one more read: the aliases backfill processes the newest 40 per
-- sync chunk and re-applies the filters as it goes.
UPDATE imap_messages SET aliases_checked = 0 WHERE aliases_json = '[]';
