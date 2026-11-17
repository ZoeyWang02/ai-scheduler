-- How many requests to the built-in (shared-key) AI each user made per UTC day.
-- Users who bring their own API key never touch this table.
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id INTEGER NOT NULL,
  day     TEXT    NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
