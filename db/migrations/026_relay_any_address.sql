-- Let a relay account send from any address on its own domain.
--
-- Typical setup: a domain that forwards many addresses (shop@DOMAIN.IT,
-- bank@DOMAIN.IT, ...) to one mailbox. With this enabled, replies leave from the
-- address the message was sent to instead of the account's own address. Off by
-- default; the send endpoint only accepts a From on the account's exact domain.
ALTER TABLE accounts ADD COLUMN relay_any_address INTEGER NOT NULL DEFAULT 0;
