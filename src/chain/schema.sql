-- Roan chain store schema.
--
-- Append-only event log shared by every chain. One SQLite file holds all chains.
-- Events are immutable; the store exposes no UPDATE and no DELETE.
--
-- `(chain, seq)` is the primary key, so a chain's sequence cannot collide even
-- when several processes append at once. `(chain, id)` is unique, which makes an
-- append carrying an already-stored id a no-op that returns the stored event.
--
-- `STRICT` rejects implicit type coercion, so a bad writer fails loudly instead
-- of silently storing `seq` as text.
--
-- Several statements run at open time and must be idempotent.
-- Keep this file in sync with src/chain/schema.ts (SCHEMA_VERSION).

PRAGMA user_version = 1;

CREATE TABLE IF NOT EXISTS events (
  chain TEXT    NOT NULL,
  seq   INTEGER NOT NULL,
  id    TEXT    NOT NULL,
  node  TEXT    NOT NULL,
  ts    INTEGER NOT NULL,
  type  TEXT    NOT NULL,
  data  TEXT    NOT NULL,
  PRIMARY KEY (chain, seq),
  UNIQUE (chain, id)
) STRICT;
