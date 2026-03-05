import https from 'https';

export interface BazaarAgent {
  name: string;
  endpoint: string;
  address?: string;
  description?: string;
  source_ref: string;
}

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https://') ? https : require('http');
    lib.get(url, { timeout: 15000, headers: { 'User-Agent': 'cred402-indexer/1.0' } }, (res: any) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Crawl x402.org/bazaar for listed services.
 */
async function crawlBazaar(): Promise<BazaarAgent[]> {
  const agents: BazaarAgent[] = [];

  try {
    console.log('  [x402bazaar] Fetching https://x402.org/bazaar...');
    const html = await fetchUrl('https://x402.org/bazaar');

    // Extract URLs and service info from HTML
    // Look for links to services, endpoints, wallet addresses
    const urlRegex = /https?:\/\/[^\s"'<>]+/g;
    const urls = html.match(urlRegex) || [];

    // Look for wallet addresses (0x...)
    const addrRegex = /0x[a-fA-F0-9]{40}/g;
    const addresses = html.match(addrRegex) || [];

    // Look for service-like URLs (not static assets)
    const serviceUrls = urls.filter(u =>
      !u.includes('.css') && !u.includes('.js') && !u.includes('.png') &&
      !u.includes('.jpg') && !u.includes('.svg') && !u.includes('fonts') &&
      !u.includes('x402.org') && !u.includes('github.com') &&
      (u.includes('.fly.dev') || u.includes('.railway.app') || u.includes('.vercel.app') ||
       u.includes('.onrender.com') || u.includes('.netlify.app') || u.includes('api.') ||
       u.includes('/v1/') || u.includes('/api/'))
    );

    for (const url of [...new Set(serviceUrls)]) {
      agents.push({
        name: new URL(url).hostname,
        endpoint: url,
        source_ref: 'x402.org/bazaar',
      });
    }

    // Also extract any structured data we can find
    // Look for JSON-LD or data attributes
    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatch) {
      for (const match of jsonLdMatch) {
        try {
          const jsonStr = match.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
          const data = JSON.parse(jsonStr);
          if (data.url) {
            agents.push({
              name: data.name || new URL(data.url).hostname,
              endpoint: data.url,
              address: data.address,
              description: data.description,
              source_ref: 'x402.org/bazaar/json-ld',
            });
          }
        } catch { /* skip invalid JSON-LD */ }
      }
    }

    // Capture any addresses found alongside service URLs
    if (addresses.length > 0 && agents.length > 0) {
      // Associate first address with first agent if no address set
      for (let i = 0; i < Math.min(addresses.length, agents.length); i++) {
        if (!agents[i].address) {
          agents[i].address = addresses[i];
        }
      }
    }

    console.log(`  [x402bazaar] Found ${agents.length} service(s) from bazaar page`);
  } catch (err: any) {
    console.log(`  [x402bazaar] Failed to fetch bazaar: ${err.message}`);
  }

  return agents;
}

/**
 * Crawl Coinbase x402 examples for known deployed endpoints.
 */
async function crawlCoinbaseExamples(): Promise<BazaarAgent[]> {
  const agents: BazaarAgent[] = [];

  // Known x402 example endpoints from Coinbase's repo
  const knownExamples = [
    { name: 'x402-next-example', endpoint: 'https://x402-next-example.vercel.app' },
    { name: 'x402-express-example', endpoint: 'https://x402-express-example.fly.dev' },
  ];

  try {
    console.log('  [x402bazaar] Fetching Coinbase x402 examples README...');
    const readmeUrl = 'https://raw.githubusercontent.com/coinbase/x402/main/README.md';
    const readme = await fetchUrl(readmeUrl);

    // Extract deployed URLs from README
    const urlRegex = /https?:\/\/[^\s)"']+(?:\.fly\.dev|\.vercel\.app|\.railway\.app|\.onrender\.com|\.netlify\.app)[^\s)"']*/g;
    const urls = readme.match(urlRegex) || [];

    for (const url of [...new Set(urls)]) {
      const cleanUrl = url.replace(/[.,;:!?)]+$/, ''); // strip trailing punctuation
      agents.push({
        name: new URL(cleanUrl).hostname,
        endpoint: cleanUrl,
        source_ref: 'github.com/coinbase/x402/README',
      });
    }

    // Also check the examples directory
    const examplesUrl = 'https://api.github.com/repos/coinbase/x402/contents/examples';
    try {
      const examplesJson = await fetchUrl(examplesUrl);
      const examples = JSON.parse(examplesJson);
      if (Array.isArray(examples)) {
        for (const entry of examples) {
          if (entry.type === 'dir') {
            // Try to fetch each example's README for endpoints
            try {
              const exReadme = await fetchUrl(`https://raw.githubusercontent.com/coinbase/x402/main/examples/${entry.name}/README.md`);
              const exUrls = exReadme.match(urlRegex) || [];
              for (const url of [...new Set(exUrls)]) {
                const cleanUrl = url.replace(/[.,;:!?)]+$/, '');
                agents.push({
                  name: `x402-${entry.name}`,
                  endpoint: cleanUrl,
                  source_ref: `github.com/coinbase/x402/examples/${entry.name}`,
                });
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch (err: any) {
      console.log(`  [x402bazaar] Failed to list examples dir: ${err.message}`);
    }

    console.log(`  [x402bazaar] Found ${agents.length} endpoint(s) from Coinbase examples`);
  } catch (err: any) {
    console.log(`  [x402bazaar] Failed to fetch Coinbase examples: ${err.message}`);
  }

  // Add known examples that we didn't find from scraping
  for (const known of knownExamples) {
    if (!agents.find(a => a.endpoint.includes(known.endpoint))) {
      agents.push({ ...known, source_ref: 'coinbase/x402/known-examples' });
    }
  }

  return agents;
}

/**
 * Main x402 bazaar source - combines bazaar page + Coinbase examples.
 */
export async function crawlX402Bazaar(): Promise<BazaarAgent[]> {
  console.log('[x402bazaar] Starting crawl...');
  const [bazaarAgents, exampleAgents] = await Promise.all([
    crawlBazaar(),
    crawlCoinbaseExamples(),
  ]);

  const all = [...bazaarAgents, ...exampleAgents];

  // Deduplicate by endpoint
  const seen = new Set<string>();
  const unique = all.filter(a => {
    if (seen.has(a.endpoint)) return false;
    seen.add(a.endpoint);
    return true;
  });

  console.log(`[x402bazaar] Total unique: ${unique.length} agent(s)`);
  return unique;
}
