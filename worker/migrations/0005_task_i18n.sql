-- A task's title and description in both languages, as JSON text: {"zh": {"title", "description"}, "en": {...}}.
-- NULL for tasks that were never translated (old tasks, imports); the original title/description columns stay the source.
ALTER TABLE tasks ADD COLUMN i18n TEXT;
