CREATE TABLE IF NOT EXISTS visitors (
  fingerprint TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visitors_expires_at ON visitors (expires_at);

CREATE TABLE IF NOT EXISTS visitor_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0)
);

INSERT OR IGNORE INTO visitor_stats (id, total) VALUES (1, 0);
