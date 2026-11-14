-- Registry of applied migrations.
--
-- scripts/migrate.mjs records every file it applies, so an interrupted upgrade
-- can be resumed and a completed one is never executed twice. Installations
-- created before this table exist keep working: the script detects that the
-- database is initialised but untracked and asks for --mark-applied once.
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
