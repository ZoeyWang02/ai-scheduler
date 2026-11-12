-- Stable identifier of the upstream item a task was imported from (e.g. a
-- Canvas assignment URL), so re-importing updates the same task instead of
-- being de-duplicated by title alone. NULL for manually created tasks.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS import_key VARCHAR(512);

CREATE INDEX IF NOT EXISTS idx_tasks_user_import_key ON tasks(user_id, import_key);
