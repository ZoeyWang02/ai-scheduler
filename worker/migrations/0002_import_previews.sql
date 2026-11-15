-- Import previews. The Java backend kept these in memory; a Worker is stateless, so a preview is
-- stored here between "preview" and "confirm" and deleted after confirming (or after an hour).

CREATE TABLE import_previews (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    payload    TEXT NOT NULL -- JSON: the preview DTO including server-side-only fields (import keys)
);

CREATE INDEX idx_import_previews_created_at ON import_previews(created_at);
