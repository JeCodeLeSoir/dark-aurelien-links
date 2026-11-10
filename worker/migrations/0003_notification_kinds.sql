ALTER TABLE poke_notifications
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'poke'
  CHECK(kind IN ('poke', 'visit'));

CREATE INDEX IF NOT EXISTS idx_poke_notifications_kind
  ON poke_notifications (kind);
