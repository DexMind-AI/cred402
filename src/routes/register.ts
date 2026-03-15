import { Router, Request, Response } from 'express';
import { getPool } from '../db/client';
import { probeX402 } from '../indexers/sources/probe';

const router = Router();

interface RegisterBody {
  address: string;
  endpoint: string;
  name: string;
  chain?: string;
  description?: string;
}

/**
 * POST /v1/register
 * Self-registration endpoint for x402 agents.
 * No payment required — free to list.
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as RegisterBody;

    // Validate required fields
    if (!body.address || !body.endpoint || !body.name) {
      res.status(400).json({
        error: 'Missing required fields: address, endpoint, name',
      });
      return;
    }

    // Validate address format (0x + 40 hex chars)
    if (!/^0x[a-fA-F0-9]{40}$/.test(body.address)) {
      res.status(400).json({
        error: 'Invalid address format. Expected 0x followed by 40 hex characters.',
      });
      return;
    }

    // Validate endpoint URL format
    try {
      const url = new URL(body.endpoint);
      if (!['http:', 'https:'].includes(url.protocol)) {
        res.status(400).json({ error: 'Endpoint must use http or https protocol.' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'Invalid endpoint URL.' });
      return;
    }

    // Validate name length
    if (body.name.length > 200) {
      res.status(400).json({ error: 'Name must be 200 characters or less.' });
      return;
    }

    const pool = getPool();
    const address = body.address.toLowerCase();
    const chain = body.chain || 'base';

    // Probe endpoint for x402 (non-blocking — we'll still register even if probe fails)
    let x402Verified = false;
    let x402Version: string | null = null;

    try {
      const probeResult = await probeX402(body.endpoint, 5000);
      x402Verified = probeResult.is402;
      x402Version = probeResult.x402Version;
      console.log(`[register] Probe ${body.endpoint}: ${probeResult.is402 ? '402 ✓' : `${probeResult.statusCode || 'unreachable'}`}`);
    } catch (err: any) {
      console.log(`[register] Probe failed: ${err.message}`);
    }

    // Upsert into agents table
    const result = await pool.query(`
      INSERT INTO agents (address, name, endpoint, source, source_ref, x402_verified, x402_version, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (address) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, agents.name),
        endpoint = COALESCE(EXCLUDED.endpoint, agents.endpoint),
        source = CASE WHEN agents.source = 'self-registered' THEN agents.source ELSE EXCLUDED.source END,
        x402_verified = EXCLUDED.x402_verified OR agents.x402_verified,
        x402_version = COALESCE(EXCLUDED.x402_version, agents.x402_version),
        metadata = agents.metadata || EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING id
    `, [
      address,
      body.name,
      body.endpoint,
      'self-registered',
      `self-register:${new Date().toISOString()}`,
      x402Verified,
      x402Version,
      JSON.stringify({
        chain,
        description: body.description || '',
        registeredVia: 'api',
      }),
    ]);

    const agentId = result.rows[0]?.id;

    // Also upsert into agent_scores for scoring
    if (agentId) {
      try {
        await pool.query(`
          INSERT INTO agent_scores (address, score, grade, label, factors)
          VALUES ($1, 0, 'U', 'Unscored', '{}')
          ON CONFLICT (address) DO NOTHING
        `, [address]);
      } catch { /* best-effort */ }

      // Record indexing signal
      try {
        await pool.query(
          `INSERT INTO signals (agent_id, address, signal_type, data) VALUES ($1, $2, $3, $4)`,
          [agentId, address, 'self_registered', JSON.stringify({
            endpoint: body.endpoint,
            chain,
            x402_verified: x402Verified,
          })]
        );
      } catch { /* best-effort */ }
    }

    // Trigger async score computation (fire-and-forget)
    if (x402Verified) {
      // If 402 verified, compute score asynchronously
      setImmediate(async () => {
        try {
          const { getAgentScore } = await import('../services/scorer');
          await getAgentScore(address as `0x${string}`);
          console.log(`[register] Score computed for ${address}`);
        } catch (err: any) {
          console.log(`[register] Score computation failed for ${address}: ${err.message}`);
        }
      });
    }

    res.status(201).json({
      agentId: agentId || null,
      address,
      x402_verified: x402Verified,
      x402_version: x402Version,
      message: x402Verified
        ? 'Agent registered and x402 verified. Scoring in progress.'
        : 'Agent registered. Endpoint did not return 402 — scoring will be limited.',
    });
  } catch (err: any) {
    console.error('[register] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
