import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

/**
 * x402 v1 Payment Requirements for a route.
 */
interface RoutePaymentConfig {
  description: string;
  resource: string;
  outputSchema?: Record<string, unknown> | null;
}

/**
 * Builds a v1-compliant 402 Payment Required response body.
 * Matches the format used by TrustLayer and other x402 ecosystem services.
 */
function build402Response(routeConfig: RoutePaymentConfig): object {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: 'base',
        maxAmountRequired: '1000', // $0.001 USDC (6 decimals)
        resource: routeConfig.resource,
        description: routeConfig.description,
        mimeType: 'application/json',
        outputSchema: routeConfig.outputSchema ?? null,
        payTo: config.treasuryAddress,
        maxTimeoutSeconds: 60,
        asset: config.usdcAddress,
        extra: {
          name: 'USD Coin',
          version: '2', // EIP-712 domain version for USDC on Base
        },
      },
    ],
  };
}

/**
 * Route configurations for x402-protected endpoints.
 */
const ROUTE_CONFIGS: Record<string, RoutePaymentConfig> = {
  score: {
    description:
      'Query the Cred402 TrustScore for an ERC-8004 AI agent. Returns a 0-100 score with grade, category breakdowns, badges, and improvement tips.',
    resource: 'https://api.cred402.com/v1/score/{agent}',
    outputSchema: {
      input: 'Ethereum address or chain:address of an AI agent',
      output: 'JSON object with score (0-100), grade, buckets, badges, and improvement tips',
    },
  },
  profile: {
    description:
      'Get the full agent profile including TrustScore, historical data, and on-chain activity summary.',
    resource: 'https://api.cred402.com/v1/profile/{agent}',
    outputSchema: {
      input: 'Ethereum address or chain:address of an AI agent',
      output: 'JSON object with full agent profile, score history, and activity data',
    },
  },
};

/**
 * Validates an X-PAYMENT header.
 *
 * For now, we accept any non-empty JSON payload as valid. Full on-chain
 * verification (EIP-712 signature + USDC allowance check) will be added
 * when the x402 mainnet facilitator is available.
 *
 * The header should contain a base64-encoded JSON payload per x402 v1 spec.
 */
function isPaymentValid(paymentHeader: string): boolean {
  try {
    // v1: the header is a base64-encoded JSON string
    const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8');
    const payload = JSON.parse(decoded);

    // Basic structural validation
    if (!payload || typeof payload !== 'object') return false;

    // Check for required v1 fields
    if (payload.x402Version === 1) {
      return !!(payload.scheme && payload.network && payload.payload);
    }

    // Also accept v2 format
    if (payload.x402Version === 2) {
      return !!(payload.scheme && payload.network && payload.payload);
    }

    // Accept legacy format (no version field)
    return !!(payload.scheme || payload.payload);
  } catch {
    // If not valid base64/JSON, reject
    return false;
  }
}

/**
 * Creates x402 payment middleware for a specific route type.
 *
 * @param routeType - Key into ROUTE_CONFIGS ('score' or 'profile')
 * @returns Express middleware that returns 402 or passes through if paid
 */
export function x402PaymentGate(routeType: 'score' | 'profile') {
  const routeConfig = ROUTE_CONFIGS[routeType];

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip payment for free-tier requests (set by rate limiter)
    if ((req as any).freeTier) {
      next();
      return;
    }

    // Check for payment header
    const paymentHeader =
      (req.headers['x-payment'] as string) ||
      (req.headers['payment-signature'] as string);

    if (!paymentHeader) {
      // No payment provided — return 402 with payment requirements
      res.status(402).json(build402Response(routeConfig));
      return;
    }

    // Validate the payment
    if (!isPaymentValid(paymentHeader)) {
      res.status(402).json({
        ...build402Response(routeConfig),
        error: 'Invalid payment payload. Expected base64-encoded JSON per x402 v1 spec.',
      });
      return;
    }

    // Payment accepted — proceed to route handler
    // TODO: When mainnet facilitator is available, verify signature and settle on-chain
    res.setHeader('X-Payment-Response', JSON.stringify({ success: true }));
    next();
  };
}
