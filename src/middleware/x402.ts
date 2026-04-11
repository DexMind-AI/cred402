import { Request, Response, NextFunction } from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { config } from '../config';

/**
 * x402 payment middleware using xpay facilitator (no KYC, no API keys).
 *
 * - Base Mainnet (eip155:8453)
 * - USDC (Mainnet) asset
 * - $0.001 per query
 * - Free tier bypass when req.freeTier is true
 */

const FACILITATOR_URL = 'https://facilitator.xpay.sh';

// Route payment configurations for x402
const X402_ROUTES: Record<string, {
  accepts: { scheme: string; price: string; network: string; payTo: string; asset: string };
  description: string;
}> = {
  'GET /v1/score/:agent': {
    accepts: {
      scheme: 'exact',
      price: '$0.001',
      network: 'eip155:84532', // Base Sepolia testnet
      payTo: config.treasuryAddress,
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia testnet USDC
    },
    description:
      'Query the Cred402 TrustScore for an ERC-8004 AI agent. Returns a 0-100 score with grade, category breakdowns, badges, and improvement tips.',
  },
  'GET /v1/profile/:agent': {
    accepts: {
      scheme: 'exact',
      price: '$0.001',
      network: 'eip155:84532', // Base Sepolia testnet
      payTo: config.treasuryAddress,
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia testnet USDC
    },
    description:
      'Get the full agent profile including TrustScore, historical data, and on-chain activity summary.',
  },
};

// Build the x402 resource server with xpay facilitator
let _middleware: ReturnType<typeof paymentMiddleware> | null = null;

function getPaymentMiddleware() {
  if (!_middleware) {
    console.log('[x402] Initializing payment middleware');
    console.log('[x402] Facilitator URL:', FACILITATOR_URL);
    console.log('[x402] Network: eip155:84532 (Base Sepolia testnet)');
    console.log('[x402] USDC:', config.usdcAddress);
    console.log('[x402] Treasury:', config.treasuryAddress);

    const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
    const resourceServer = new x402ResourceServer(facilitatorClient)
      .register('eip155:84532', new ExactEvmScheme()); // Base Sepolia

    _middleware = paymentMiddleware(
      X402_ROUTES,
      resourceServer,
      undefined, // no paywall config
      undefined, // no custom paywall
      true,      // sync facilitator on start
    );
  }
  return _middleware;
}

/**
 * Wraps the @x402/express payment middleware with free-tier bypass and error handling.
 *
 * Usage in app.ts:  app.use(x402Gate())
 */
export function x402Gate() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    console.log(`[x402] Gate hit: ${req.method} ${req.path} | freeTier=${(req as any).freeTier}`);

    // Free tier bypass — set by rate limiter middleware
    if ((req as any).freeTier) {
      console.log('[x402] Free tier bypass — skipping payment check');
      next();
      return;
    }

    console.log('[x402] No free tier — invoking payment middleware');

    try {
      const mw = getPaymentMiddleware();
      console.log('[x402] Middleware initialized:', mw ? 'yes' : 'no');
      await mw(req, res, next);
      console.log(`[x402] Payment middleware completed. Response status: ${res.statusCode}`);
    } catch (err) {
      console.error('[x402] Facilitator error:', err);
      res.status(503).json({
        error: 'Payment verification service temporarily unavailable',
        message: 'The x402 facilitator is unreachable. Please try again later.',
      });
    }
  };
}

/**
 * @deprecated Use x402Gate() instead. Kept for backward compatibility.
 */
export function x402PaymentGate(_routeType: 'score' | 'profile') {
  return x402Gate();
}