-- Contacts created automatically from a sent message live in "Other contacts":
-- they participate in autocomplete but can be promoted by editing them.
ALTER TABLE contacts ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
