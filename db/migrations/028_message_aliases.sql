-- Addresses the message was originally sent to, from its forwarding headers.
--
-- A domain that only forwards (info@domain.it -> me@provider.com) leaves its
-- address in Delivered-To/X-Original-To/Received ... for rather than in To, so a
-- filter on "to: info@domain.it" could never match. The sync stores those
-- addresses here and matchesFilter() checks the filter's "to" against them too.
ALTER TABLE imap_messages ADD COLUMN aliases_json TEXT NOT NULL DEFAULT '[]';
