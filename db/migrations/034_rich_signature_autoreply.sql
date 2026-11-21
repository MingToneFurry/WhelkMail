-- Rich-text signatures and vacation-responder bodies. The existing plain-text
-- columns stay the fallback for clients that send text/plain and for rows saved
-- before this migration.
ALTER TABLE accounts ADD COLUMN signature_html TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN auto_reply_body_html TEXT NOT NULL DEFAULT '';
