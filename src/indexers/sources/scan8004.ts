import https from 'https';

export interface Scan8004Agent {
  agentId: string;
  address: string;
  chain: string;
  chainId: number;
  endpoint: string;
  name: string;
  description?: string;
  x402Supported: boolean;
  registeredAt?: string;
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'cred402-indexer/1.0',
        'Accept': 'application/json',
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Invalid JSON from ${url}: ${data.slice(0, 200)}`)); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

const CHAIN_ID_MAP: Record<number, string> = {
  1: 'ethereum',
  8453: 'base',
  84532: 'base-sepolia',
  42220: 'celo',
  56: 'bsc',
  137: 'polygon',
  10: 'optimism',
  42161: 'arbitrum',
};

/**
 * Extract primary endpoint from 8004scan agent services.
 */
function extractEndpoint(agent: any): string {
  if (!agent.services) return '';
  // Priority: web > api > mcp > a2a
  for (const key of ['web', 'api', 'mcp', 'a2a']) {
    if (agent.services[key]?.endpoint) {
      const ep = agent.services[key].endpoint;
      if (ep.startsWith('http://') || ep.startsWith('https://')) return ep;
    }
  }
  return '';
}

/**
 * Crawl 8004scan.io API for all registered ERC-8004 agents.
 * Paginated — fetches all pages.
 */
export async function crawlScan8004(): Promise<Scan8004Agent[]> {
  console.log('[8004scan] Starting crawl of 8004scan.io...');
  const agents: Scan8004Agent[] = [];
  const PAGE_SIZE = 100;
  let offset = 0;
  let total = 0;

  try {
    // First request to get total count
    const firstPage = await fetchJson(`https://8004scan.io/api/v1/agents?limit=${PAGE_SIZE}&offset=0`);
    total = firstPage.total || 0;
    console.log(`  [8004scan] Total agents on 8004scan: ${total}`);

    if (!firstPage.items || !Array.isArray(firstPage.items)) {
      console.log('  [8004scan] No items array in response');
      return agents;
    }

    // Process first page
    processItems(firstPage.items, agents);
    offset += PAGE_SIZE;

    // Fetch remaining pages (cap at 10k to be reasonable about time)
    const maxAgents = Math.min(total, 10000);
    while (offset < maxAgents) {
      try {
        console.log(`  [8004scan] Fetching page offset=${offset}/${maxAgents}...`);
        const page = await fetchJson(`https://8004scan.io/api/v1/agents?limit=${PAGE_SIZE}&offset=${offset}`);
        if (!page.items || page.items.length === 0) break;
        processItems(page.items, agents);
        offset += PAGE_SIZE;
        // Small delay to be polite
        await new Promise(r => setTimeout(r, 200));
      } catch (err: any) {
        console.log(`  [8004scan] Page fetch error at offset=${offset}: ${err.message}`);
        break;
      }
    }
  } catch (err: any) {
    console.error(`  [8004scan] Initial fetch failed: ${err.message}`);
    return agents;
  }

  // Deduplicate by address
  const seen = new Set<string>();
  const unique = agents.filter(a => {
    const key = a.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[8004scan] Crawled ${offset} entries, extracted ${unique.length} unique agents (${agents.length} total before dedup)`);
  return unique;
}

function processItems(items: any[], agents: Scan8004Agent[]): void {
  for (const item of items) {
    if (!item.owner_address && !item.agent_wallet) continue;

    const address = item.agent_wallet || item.owner_address || '';
    const chainId = item.chain_id || 8453;
    const chain = CHAIN_ID_MAP[chainId] || `chain-${chainId}`;
    const endpoint = extractEndpoint(item);
    const name = item.name || `Agent #${item.token_id || 'unknown'}`;

    agents.push({
      agentId: item.agent_id || `${chainId}:${item.contract_address}:${item.token_id}`,
      address,
      chain,
      chainId,
      endpoint,
      name,
      description: item.description?.slice(0, 500),
      x402Supported: item.x402_supported === true,
      registeredAt: item.created_at,
    });
  }
}
