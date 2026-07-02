ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_token VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS canvas_token VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS utc_offset VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_token ON users(auth_token);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS color VARCHAR(7);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ai_metadata JSONB;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS preceded_by_id BIGINT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_tasks_user'
    ) THEN
        ALTER TABLE tasks
        ADD CONSTRAINT fk_tasks_user
        FOREIGN KEY (user_id)
        REFERENCES users(id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_tasks_preceded_by'
    ) THEN
        ALTER TABLE tasks
        ADD CONSTRAINT fk_tasks_preceded_by
        FOREIGN KEY (preceded_by_id)
        REFERENCES tasks(id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS course_events (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    location VARCHAR(255),
    user_id BIGINT NOT NULL REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_course_events_user_id ON course_events(user_id);
CREATE INDEX IF NOT EXISTS idx_course_events_start_time ON course_events(start_time);
