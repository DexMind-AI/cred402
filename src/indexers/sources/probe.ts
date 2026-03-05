import http from 'http';
import https from 'https';

export interface X402ProbeResult {
  url: string;
  reachable: boolean;
  statusCode: number;
  is402: boolean;
  x402Version: string | null;
  latencyMs: number;
  headers: Record<string, string>;
}

/**
 * Probe a URL to check if it returns HTTP 402 with x402 headers.
 */
export async function probeX402(url: string, timeoutMs = 8000): Promise<X402ProbeResult> {
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return { url, reachable: false, statusCode: 0, is402: false, x402Version: null, latencyMs: 0, headers: {} };
  }

  const start = Date.now();
  const lib = url.startsWith('https://') ? https : http;

  return new Promise<X402ProbeResult>((resolve) => {
    const req = lib.request(url, { method: 'GET', timeout: timeoutMs }, (res) => {
      const latencyMs = Date.now() - start;
      const statusCode = res.statusCode || 0;
      const rawHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (v) rawHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
      }

      // Check for x402 indicators
      const x402Version = rawHeaders['x402version'] || rawHeaders['x-402-version'] || null;
      const is402 = statusCode === 402;

      res.resume(); // drain
      resolve({ url, reachable: true, statusCode, is402, x402Version, latencyMs, headers: rawHeaders });
    });

    req.on('error', () => {
      resolve({ url, reachable: false, statusCode: 0, is402: false, x402Version: null, latencyMs: Date.now() - start, headers: {} });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ url, reachable: false, statusCode: 0, is402: false, x402Version: null, latencyMs: timeoutMs, headers: {} });
    });

    req.end();
  });
}

/**
 * Probe multiple URLs, return results for all.
 */
export async function probeMany(urls: string[], concurrency = 5): Promise<X402ProbeResult[]> {
  const results: X402ProbeResult[] = [];

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(url => probeX402(url)));
    results.push(...batchResults);
  }

  return results;
}
