-- Structured contact fields for vCard 3.0/4.0 import/export.
-- `name` stays the display name used by autocomplete; first/last are the N field.
ALTER TABLE contacts ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN last_name TEXT NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN company TEXT NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN job_title TEXT NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN website TEXT NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN birthday TEXT NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN emails_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE contacts ADD COLUMN phones_json TEXT NOT NULL DEFAULT '[]';
