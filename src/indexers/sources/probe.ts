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

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Reject template/placeholder URLs
    if (parsed.hostname.includes('<') || parsed.hostname.includes('>') ||
        parsed.hostname.includes('{') || parsed.hostname.includes('}') ||
        parsed.hostname.includes('`') || parsed.hostname.includes('$') ||
        parsed.hostname.includes('example.com') || parsed.hostname.includes('your-')) {
      return false;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Probe a URL to check if it returns HTTP 402 with x402 headers.
 */
export async function probeX402(url: string, timeoutMs = 8000): Promise<X402ProbeResult> {
  const fail: X402ProbeResult = { url, reachable: false, statusCode: 0, is402: false, x402Version: null, latencyMs: 0, headers: {} };

  if (!isValidUrl(url)) return fail;

  const start = Date.now();
  const lib = url.startsWith('https://') ? https : http;

  return new Promise<X402ProbeResult>((resolve) => {
    try {
      const req = lib.request(url, { method: 'GET', timeout: timeoutMs }, (res) => {
        const latencyMs = Date.now() - start;
        const statusCode = res.statusCode || 0;
        const rawHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v) rawHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
        }

        const x402Version = rawHeaders['x402version'] || rawHeaders['x-402-version'] || null;
        const is402 = statusCode === 402;

        res.resume();
        resolve({ url, reachable: true, statusCode, is402, x402Version, latencyMs, headers: rawHeaders });
      });

      req.on('error', () => {
        resolve({ ...fail, latencyMs: Date.now() - start });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ ...fail, latencyMs: timeoutMs });
      });

      req.end();
    } catch {
      resolve(fail);
    }
  });
}

/**
 * Probe multiple URLs, return results for all.
 */
export async function probeMany(urls: string[], concurrency = 5): Promise<X402ProbeResult[]> {
  const results: X402ProbeResult[] = [];
  // Filter to valid URLs only
  const validUrls = urls.filter(isValidUrl);

  for (let i = 0; i < validUrls.length; i += concurrency) {
    const batch = validUrls.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(url => probeX402(url)));
    results.push(...batchResults);
  }

  return results;
}
