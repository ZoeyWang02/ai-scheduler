-- D1 (SQLite) equivalent of the Postgres Flyway migrations V1..V4.
-- Timestamps are stored as UTC text "YYYY-MM-DDTHH:MM:SS" (what Hibernate's LocalDateTime held);
-- JSON columns (preferences, ai_metadata) are stored as JSON text.

CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    username      TEXT UNIQUE,
    password_hash TEXT,
    auth_token    TEXT UNIQUE,
    name          TEXT,
    canvas_token  TEXT,
    created_at    TEXT,
    timezone      TEXT NOT NULL DEFAULT 'America/Chicago',
    utc_offset    TEXT,
    preferences   TEXT
);

CREATE TABLE tasks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT,
    description    TEXT,
    due_date       TEXT,
    completed      INTEGER NOT NULL DEFAULT 0,
    completed_at   TEXT,
    ai_metadata    TEXT,
    preceded_by_id INTEGER REFERENCES tasks(id),
    user_id        INTEGER NOT NULL REFERENCES users(id),
    color          TEXT,
    import_key     TEXT
);

CREATE TABLE course_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT,
    start_time TEXT NOT NULL,
    end_time   TEXT NOT NULL,
    location   TEXT,
    user_id    INTEGER NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_tasks_user_import_key ON tasks(user_id, import_key);
CREATE INDEX idx_course_events_user_id ON course_events(user_id);
CREATE INDEX idx_course_events_start_time ON course_events(start_time);
