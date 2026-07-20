-- BNDZ license registry (1 seat per serial)
CREATE TABLE IF NOT EXISTS serials (
  serial TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  note TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS activations (
  id TEXT PRIMARY KEY NOT NULL,
  serial TEXT NOT NULL,
  hwid TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  deactivated_at TEXT,
  token_jti TEXT NOT NULL,
  FOREIGN KEY (serial) REFERENCES serials(serial)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_activations_active_serial
  ON activations(serial) WHERE deactivated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_activations_hwid ON activations(hwid);
CREATE INDEX IF NOT EXISTS idx_serials_revoked ON serials(revoked_at);
