// Type declarations for @x402 packages which export ESM-only types
// These packages work fine at runtime via CJS but their types need node16 moduleResolution

declare module '@x402/express' {
  import type { RequestHandler } from 'express';

  export class x402ResourceServer {
    constructor(facilitatorClient: any);
    register(network: string, scheme: any): this;
  }

  export function paymentMiddleware(
    routes: Record<string, {
      accepts: {
        scheme: string;
        price: string;
        network: string;
        payTo: string;
        asset?: string;
      };
      description?: string;
    }>,
    server: x402ResourceServer,
    paywallConfig?: any,
    paywall?: any,
    syncFacilitatorOnStart?: boolean,
  ): RequestHandler;
}

declare module '@x402/evm/exact/server' {
  export class ExactEvmScheme {
    constructor();
  }
}

declare module '@x402/core/server' {
  export class HTTPFacilitatorClient {
    constructor(config: { url: string });
  }
}
