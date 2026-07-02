CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    username VARCHAR(255),
    password_hash VARCHAR(255),
    auth_token VARCHAR(255),
    name VARCHAR(255),
    canvas_token VARCHAR(255),
    created_at TIMESTAMP,
    timezone VARCHAR(255),
    utc_offset VARCHAR(255),
    CONSTRAINT uk_users_email UNIQUE (email),
    CONSTRAINT uk_users_username UNIQUE (username),
    CONSTRAINT uk_users_auth_token UNIQUE (auth_token)
);

CREATE TABLE IF NOT EXISTS tasks (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255),
    description TEXT,
    due_date TIMESTAMP,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    ai_metadata JSONB,
    preceded_by_id BIGINT,
    user_id BIGINT NOT NULL,
    color VARCHAR(7),
    CONSTRAINT fk_tasks_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_tasks_preceded_by FOREIGN KEY (preceded_by_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS course_events (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    location VARCHAR(255),
    user_id BIGINT NOT NULL,
    CONSTRAINT fk_course_events_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_course_events_user_id ON course_events(user_id);
CREATE INDEX IF NOT EXISTS idx_course_events_start_time ON course_events(start_time);
