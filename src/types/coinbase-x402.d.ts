declare module '@coinbase/x402' {
  import { FacilitatorConfig } from '@x402/core/http';

  export function createAuthHeader(
    apiKeyId: string,
    apiKeySecret: string,
    requestMethod: string,
    requestHost: string,
    requestPath: string,
  ): Promise<string>;

  export function createCorrelationHeader(): string;

  export function createCdpAuthHeaders(
    apiKeyId?: string,
    apiKeySecret?: string,
  ): FacilitatorConfig['createAuthHeaders'];

  export function createFacilitatorConfig(
    apiKeyId?: string,
    apiKeySecret?: string,
  ): FacilitatorConfig;

  export const facilitator: FacilitatorConfig;
}
