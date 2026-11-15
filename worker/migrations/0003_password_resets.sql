-- Password reset codes. The Java backend kept them in memory and printed them to its log; a Worker is
-- stateless and must send an e-mail, so the (hashed) code is stored here until it is used or expires.

CREATE TABLE password_resets (
    email      TEXT PRIMARY KEY,
    code_hash  TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
