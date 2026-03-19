import { Request, Response, NextFunction } from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { facilitator } from '@coinbase/x402';
import { config } from '../config';

/**
 * x402 payment middleware using Coinbase CDP facilitator for real payment verification.
 *
 * - Base mainnet (eip155:8453)
 * - USDC asset
 * - $0.001 per query
 * - Free tier bypass when req.freeTier is true
 *
 * Uses @coinbase/x402 for the official CDP facilitator URL and auth.
 * Requires CDP_API_KEY_ID and CDP_API_KEY_SECRET env vars.
 */

// Route payment configurations for x402
const X402_ROUTES: Record<string, {
  accepts: { scheme: string; price: string; network: string; payTo: string; asset: string };
  description: string;
}> = {
  'GET /v1/score/:agent': {
    accepts: {
      scheme: 'exact',
      price: '$0.001',
      network: 'eip155:8453',
      payTo: config.treasuryAddress,
      asset: config.usdcAddress,
    },
    description:
      'Query the Cred402 TrustScore for an ERC-8004 AI agent. Returns a 0-100 score with grade, category breakdowns, badges, and improvement tips.',
  },
  'GET /v1/profile/:agent': {
    accepts: {
      scheme: 'exact',
      price: '$0.001',
      network: 'eip155:8453',
      payTo: config.treasuryAddress,
      asset: config.usdcAddress,
    },
    description:
      'Get the full agent profile including TrustScore, historical data, and on-chain activity summary.',
  },
};

// Build the x402 resource server with Coinbase CDP facilitator
let _middleware: ReturnType<typeof paymentMiddleware> | null = null;

function getPaymentMiddleware() {
  if (!_middleware) {
    const facilitatorClient = new HTTPFacilitatorClient(facilitator);
    const resourceServer = new x402ResourceServer(facilitatorClient)
      .register('eip155:8453', new ExactEvmScheme());

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
    // Free tier bypass — set by rate limiter middleware
    if ((req as any).freeTier) {
      next();
      return;
    }

    try {
      const mw = getPaymentMiddleware();
      await mw(req, res, next);
    } catch (err) {
      console.error('x402 facilitator error:', err);
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
