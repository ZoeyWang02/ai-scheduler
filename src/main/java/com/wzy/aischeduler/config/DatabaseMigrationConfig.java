package com.wzy.aischeduler.config;

import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class DatabaseMigrationConfig {

    private final JdbcTemplate jdbcTemplate;

    public DatabaseMigrationConfig(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @PostConstruct
    public void migrate() {
        jdbcTemplate.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(255)");
        jdbcTemplate.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)");
        jdbcTemplate.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)");

        jdbcTemplate.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id BIGINT");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)");
        jdbcTemplate.execute("""
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
                """);

        jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS course_events (
                    id BIGSERIAL PRIMARY KEY,
                    title VARCHAR(255),
                    start_time TIMESTAMP NOT NULL,
                    end_time TIMESTAMP NOT NULL,
                    location VARCHAR(255),
                    user_id BIGINT NOT NULL REFERENCES users(id)
                )
                """);
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_course_events_user_id ON course_events(user_id)");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_course_events_start_time ON course_events(start_time)");
    }
}
