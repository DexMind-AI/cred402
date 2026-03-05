/**
 * cred402 Agent Indexer — Seeds the database by crawling multiple sources.
 *
 * Sources:
 *   1. x402.org/bazaar + Coinbase x402 examples
 *   2. GitHub search for x402 implementations
 *   3. ERC-8004 on-chain registry (Base mainnet)
 *   4. Direct HTTP 402 probing on all discovered endpoints
 *
 * Usage:
 *   npx tsx src/indexers/seed.ts
 *   # or inside Docker:
 *   docker exec cred402-api node dist/indexers/seed.js
 */

import { Pool } from 'pg';
import { crawlX402Bazaar } from './sources/x402bazaar';
import { crawlGitHub } from './sources/github';
import { crawlERC8004 } from './sources/erc8004';
import { probeX402, probeMany } from './sources/probe';

// ----- Types -----

interface DiscoveredAgent {
  name: string;
  endpoint: string;
  address?: string;
  source: string;
  source_ref: string;
  metadata: Record<string, any>;
}

// ----- DB helpers -----

function getPool(): Pool {
  const url = process.env.DATABASE_URL || 'postgres://cred402:cred402@localhost:5432/cred402';
  return new Pool({ connectionString: url, max: 5 });
}

async function ensureTables(pool: Pool): Promise<void> {
  // Run migration 002 inline (idempotent with IF NOT EXISTS)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id            SERIAL PRIMARY KEY,
      address       TEXT UNIQUE,
      name          TEXT NOT NULL,
      endpoint      TEXT,
      source        TEXT NOT NULL,
      source_ref    TEXT,
      x402_verified BOOLEAN NOT NULL DEFAULT FALSE,
      x402_version  TEXT,
      metadata      JSONB NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_agents_address ON agents(address);
    CREATE INDEX IF NOT EXISTS idx_agents_source ON agents(source);
    CREATE INDEX IF NOT EXISTS idx_agents_x402_verified ON agents(x402_verified);

    CREATE TABLE IF NOT EXISTS signals (
      id            SERIAL PRIMARY KEY,
      agent_id      INTEGER REFERENCES agents(id),
      address       TEXT,
      signal_type   TEXT NOT NULL,
      data          JSONB NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_signals_agent_id ON signals(agent_id);
    CREATE INDEX IF NOT EXISTS idx_signals_signal_type ON signals(signal_type);
  `);
}

async function upsertAgent(
  pool: Pool,
  agent: DiscoveredAgent & { x402_verified?: boolean; x402_version?: string }
): Promise<number> {
  // Use endpoint as the unique key if no address, since address can be null
  // For agents with an address, upsert by address; for others, upsert by (name, source)
  const result = agent.address
    ? await pool.query(`
        INSERT INTO agents (address, name, endpoint, source, source_ref, x402_verified, x402_version, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (address) DO UPDATE SET
          name = COALESCE(EXCLUDED.name, agents.name),
          endpoint = COALESCE(EXCLUDED.endpoint, agents.endpoint),
          source = EXCLUDED.source,
          source_ref = EXCLUDED.source_ref,
          x402_verified = EXCLUDED.x402_verified OR agents.x402_verified,
          x402_version = COALESCE(EXCLUDED.x402_version, agents.x402_version),
          metadata = agents.metadata || EXCLUDED.metadata,
          updated_at = NOW()
        RETURNING id
      `, [
        agent.address, agent.name, agent.endpoint, agent.source,
        agent.source_ref, agent.x402_verified || false, agent.x402_version || null,
        JSON.stringify(agent.metadata),
      ])
    : await pool.query(`
        INSERT INTO agents (name, endpoint, source, source_ref, x402_verified, x402_version, metadata, address)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [
        agent.name, agent.endpoint, agent.source,
        agent.source_ref, agent.x402_verified || false, agent.x402_version || null,
        JSON.stringify(agent.metadata), null,
      ]);

  return result.rows[0]?.id || 0;
}

async function insertSignal(
  pool: Pool,
  agentId: number | null,
  address: string | null,
  signalType: string,
  data: Record<string, any>
): Promise<void> {
  await pool.query(
    `INSERT INTO signals (agent_id, address, signal_type, data) VALUES ($1, $2, $3, $4)`,
    [agentId, address, signalType, JSON.stringify(data)]
  );
}

// Also upsert into agent_scores for the scoring engine
async function upsertAgentScore(pool: Pool, address: string): Promise<void> {
  if (!address) return;
  await pool.query(`
    INSERT INTO agent_scores (address, score, grade, label, factors)
    VALUES ($1, 0, 'U', 'Unscored', '{}')
    ON CONFLICT (address) DO NOTHING
  `, [address]);
}

// ----- Main -----

async function seed(): Promise<void> {
  console.log('=== cred402 Agent Indexer ===');
  console.log(`Started at ${new Date().toISOString()}`);
  console.log('');

  const pool = getPool();

  try {
    // Ensure tables exist
    await ensureTables(pool);
    console.log('Database tables ready.\n');

    const allAgents: DiscoveredAgent[] = [];
    const stats: Record<string, number> = {};

    // --- Source 1: x402.org/bazaar ---
    try {
      const bazaarAgents = await crawlX402Bazaar();
      for (const a of bazaarAgents) {
        allAgents.push({
          name: a.name,
          endpoint: a.endpoint,
          address: a.address,
          source: 'x402_bazaar',
          source_ref: a.source_ref,
          metadata: { description: a.description },
        });
      }
      stats['x402_bazaar'] = bazaarAgents.length;
    } catch (err: any) {
      console.error(`[FAIL] x402 bazaar: ${err.message}`);
      stats['x402_bazaar'] = 0;
    }
    console.log('');

    // --- Source 2: GitHub ---
    let githubToken: string | undefined;
    try {
      const fs = require('fs');
      if (fs.existsSync('/home/linus/.secrets/github_pat_classic')) {
        githubToken = fs.readFileSync('/home/linus/.secrets/github_pat_classic', 'utf-8').trim();
      }
    } catch { /* no token available */ }

    try {
      const ghAgents = await crawlGitHub(githubToken);
      for (const a of ghAgents) {
        allAgents.push({
          name: a.name,
          endpoint: a.endpoint,
          address: a.address,
          source: 'github',
          source_ref: a.repoUrl,
          metadata: { description: a.description },
        });
      }
      stats['github'] = ghAgents.length;
    } catch (err: any) {
      console.error(`[FAIL] GitHub: ${err.message}`);
      stats['github'] = 0;
    }
    console.log('');

    // --- Source 3: ERC-8004 on-chain ---
    try {
      const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
      const registryAddr = process.env.ERC8004_REGISTRY || '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
      const onchainAgents = await crawlERC8004(registryAddr, rpcUrl);
      for (const a of onchainAgents) {
        allAgents.push({
          name: a.name || `agent-${a.agentId}`,
          endpoint: a.endpoint,
          address: a.address,
          source: 'erc8004',
          source_ref: `registry:${registryAddr}/agent:${a.agentId}`,
          metadata: { agentId: a.agentId, registeredAt: a.registeredAt },
        });
      }
      stats['erc8004'] = onchainAgents.length;
    } catch (err: any) {
      console.error(`[FAIL] ERC-8004: ${err.message}`);
      stats['erc8004'] = 0;
    }
    console.log('');

    // --- Deduplicate by endpoint ---
    const seen = new Set<string>();
    const uniqueAgents = allAgents.filter(a => {
      const key = a.endpoint || `${a.name}:${a.source}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`Total discovered: ${allAgents.length}, unique: ${uniqueAgents.length}`);
    console.log('');

    // --- Source 4: Probe all endpoints for 402 ---
    console.log('[probe] Probing all endpoints for x402...');
    const endpointsToProbe = uniqueAgents
      .map(a => a.endpoint)
      .filter(e => e && (e.startsWith('http://') || e.startsWith('https://')));

    const probeResults = await probeMany(endpointsToProbe);
    const probeMap = new Map(probeResults.map(r => [r.url, r]));

    let verifiedCount = 0;
    for (const result of probeResults) {
      if (result.is402) verifiedCount++;
      console.log(`  ${result.is402 ? '✓' : result.reachable ? '○' : '✗'} ${result.url} → ${result.statusCode || 'unreachable'}${result.x402Version ? ` (x402: ${result.x402Version})` : ''}`);
    }
    stats['x402_verified'] = verifiedCount;
    console.log(`[probe] ${verifiedCount} verified x402 service(s) out of ${endpointsToProbe.length} probed\n`);

    // --- Insert into DB ---
    console.log('Upserting agents into database...');
    let insertedCount = 0;

    for (const agent of uniqueAgents) {
      const probe = probeMap.get(agent.endpoint);
      const agentId = await upsertAgent(pool, {
        ...agent,
        x402_verified: probe?.is402 || false,
        x402_version: probe?.x402Version || undefined,
      });

      if (agentId > 0) {
        insertedCount++;

        // Record indexing signal
        await insertSignal(pool, agentId, agent.address || null, 'indexed', {
          source: agent.source,
          source_ref: agent.source_ref,
        });

        // Record probe signal
        if (probe) {
          await insertSignal(pool, agentId, agent.address || null,
            probe.is402 ? 'x402_detected' : probe.reachable ? 'probe_success' : 'probe_fail',
            { statusCode: probe.statusCode, latencyMs: probe.latencyMs, x402Version: probe.x402Version }
          );
        }

        // Also seed agent_scores if we have an address
        if (agent.address) {
          await upsertAgentScore(pool, agent.address);
        }
      }
    }

    // --- Summary ---
    console.log('\n=== Indexer Summary ===');
    console.log(`Agents inserted/updated: ${insertedCount}`);
    for (const [source, count] of Object.entries(stats)) {
      console.log(`  ${source}: ${count}`);
    }

    // Final count
    const countResult = await pool.query('SELECT count(*) as total FROM agents');
    const scoreCount = await pool.query('SELECT count(*) as total FROM agent_scores');
    console.log(`\nTotal agents in DB: ${countResult.rows[0].total}`);
    console.log(`Total agent_scores in DB: ${scoreCount.rows[0].total}`);
    console.log(`\nCompleted at ${new Date().toISOString()}`);

  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Indexer failed:', err);
  process.exit(1);
});
