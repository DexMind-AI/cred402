-- Discovered agents table for the indexer
CREATE TABLE IF NOT EXISTS agents (
  id            SERIAL PRIMARY KEY,
  address       TEXT UNIQUE,                     -- wallet address (nullable for agents found without one)
  name          TEXT NOT NULL,
  endpoint      TEXT,                            -- service URL
  source        TEXT NOT NULL,                   -- 'x402_bazaar', 'github', 'erc8004', 'manual'
  source_ref    TEXT,                            -- source-specific reference (repo URL, registry ID, etc)
  x402_verified BOOLEAN NOT NULL DEFAULT FALSE,  -- confirmed 402 response with x402 headers
  x402_version  TEXT,                            -- x402Version header value if found
  metadata      JSONB NOT NULL DEFAULT '{}',     -- extra data from source
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_address ON agents(address);
CREATE INDEX IF NOT EXISTS idx_agents_source ON agents(source);
CREATE INDEX IF NOT EXISTS idx_agents_x402_verified ON agents(x402_verified);

-- Signals table for indexer events
CREATE TABLE IF NOT EXISTS signals (
  id            SERIAL PRIMARY KEY,
  agent_id      INTEGER REFERENCES agents(id),
  address       TEXT,
  signal_type   TEXT NOT NULL,                   -- 'indexed', 'probe_success', 'probe_fail', 'x402_detected'
  data          JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_agent_id ON signals(agent_id);
CREATE INDEX IF NOT EXISTS idx_signals_signal_type ON signals(signal_type);
