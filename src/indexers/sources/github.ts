import https from 'https';

export interface GitHubAgent {
  name: string;
  endpoint: string;
  address?: string;
  repoUrl: string;
  description?: string;
}

function fetchJson(url: string, token?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'User-Agent': 'cred402-indexer/1.0',
      'Accept': 'application/vnd.github.v3+json',
    };
    if (token) headers['Authorization'] = `token ${token}`;

    const parsed = new URL(url);
    https.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers,
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Invalid JSON from ${url}`)); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function fetchRaw(url: string, token?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'User-Agent': 'cred402-indexer/1.0' };
    if (token) headers['Authorization'] = `token ${token}`;

    const parsed = new URL(url);
    https.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers,
      timeout: 15000,
    }, (res: any) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchRaw(res.headers.location, token).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

const DEPLOYED_URL_PATTERN = /https?:\/\/[^\s)"'`\]]+(?:\.fly\.dev|\.railway\.app|\.vercel\.app|\.onrender\.com|\.render\.com|\.netlify\.app|\.herokuapp\.com|\.up\.railway\.app|\.deno\.dev|\.workers\.dev)[^\s)"'`\]]*/g;
const CUSTOM_DOMAIN_PATTERN = /https?:\/\/(?:api\.|app\.)[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}[^\s)"'`\]]*/g;
const WALLET_PATTERN = /0x[a-fA-F0-9]{40}/g;

/** Filter out template/placeholder URLs */
function isRealUrl(url: string): boolean {
  return !/<|>|\{|\}|\$|`|your-|example|placeholder|PROJECT|APP_NAME|localhost|127\.0\.0/i.test(url);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Search GitHub Code Search API for files containing x402 package references.
 * Falls back to repo search if code search fails.
 */
async function codeSearch(query: string, token?: string): Promise<string[]> {
  const repos = new Set<string>();
  const encoded = encodeURIComponent(query);

  // Try code search first (requires auth, returns file-level results)
  if (token) {
    try {
      for (let page = 1; page <= 5; page++) {
        const url = `https://api.github.com/search/code?q=${encoded}&per_page=100&page=${page}`;
        const result = await fetchJson(url, token);

        if (result.message) {
          console.log(`  [github] Code search API: ${result.message}`);
          if (result.message.includes('rate limit')) break;
          if (result.message.includes('must include')) break; // Need more specific query
          break;
        }

        const items = result.items || [];
        for (const item of items) {
          if (item.repository?.full_name) {
            repos.add(item.repository.full_name);
          }
        }

        if (items.length < 100) break;
        await sleep(3000); // Code search has strict rate limits
      }
    } catch (err: any) {
      console.log(`  [github] Code search failed: ${err.message}`);
    }
  }

  // Also do repo search (works without auth)
  try {
    const repoUrl = `https://api.github.com/search/repositories?q=${encoded}&per_page=30&sort=updated`;
    const result = await fetchJson(repoUrl, token);
    if (!result.message) {
      for (const item of result.items || []) {
        if (item.full_name) repos.add(item.full_name);
      }
    }
  } catch { /* skip */ }

  return Array.from(repos);
}

/**
 * Extract deployed URLs from a README.
 */
function extractUrls(readme: string): string[] {
  const urls = new Set<string>();

  // Standard deployment platforms
  const platformMatches = readme.match(DEPLOYED_URL_PATTERN) || [];
  for (const m of platformMatches) {
    const clean = m.replace(/[.,;:!?)]+$/, '');
    if (isRealUrl(clean)) urls.add(clean);
  }

  // Custom domains (api.*, app.*)
  const customMatches = readme.match(CUSTOM_DOMAIN_PATTERN) || [];
  for (const m of customMatches) {
    const clean = m.replace(/[.,;:!?)]+$/, '');
    if (isRealUrl(clean) && !clean.includes('github.com') && !clean.includes('npmjs.com')) {
      urls.add(clean);
    }
  }

  return Array.from(urls);
}

/**
 * Search GitHub for x402 implementations using both Code Search and Repo Search.
 * Exhaustive: searches for all x402 package variants in package.json files.
 */
export async function crawlGitHub(token?: string): Promise<GitHubAgent[]> {
  console.log('[github] Starting exhaustive GitHub search...');
  const agents: GitHubAgent[] = [];
  const seenRepos = new Set<string>();

  // --- Phase 1: Code Search for package.json containing x402 packages ---
  const codeSearchQueries = [
    '@coinbase/x402 filename:package.json',
    'x402/express filename:package.json',
    'x402/next filename:package.json',
    'x402/fastify filename:package.json',
    'x402/hono filename:package.json',
  ];

  for (const query of codeSearchQueries) {
    try {
      console.log(`  [github] Code searching: "${query}"...`);
      const repos = await codeSearch(query, token);
      console.log(`  [github] Found ${repos.length} repo(s)`);
      for (const r of repos) seenRepos.add(r);
      await sleep(2000);
    } catch (err: any) {
      console.log(`  [github] Search error: ${err.message}`);
    }
  }

  // --- Phase 2: Repo Search for broader x402-related repos ---
  const repoQueries = [
    'x402 in:name,description,readme',
    'x402 express',
    'x402 payment',
    'erc-8004 agent',
    'coinbase x402',
    'x402 middleware',
    'x402 paywall',
  ];

  for (const query of repoQueries) {
    try {
      console.log(`  [github] Repo searching: "${query}"...`);
      const encoded = encodeURIComponent(query);
      const searchUrl = `https://api.github.com/search/repositories?q=${encoded}&per_page=30&sort=updated`;
      const results = await fetchJson(searchUrl, token);

      if (results.message) {
        console.log(`  [github] API: ${results.message}`);
        if (results.message.includes('rate limit')) break;
        continue;
      }

      for (const item of results.items || []) {
        if (item.full_name) seenRepos.add(item.full_name);
      }
      await sleep(2000);
    } catch (err: any) {
      console.log(`  [github] Search error: ${err.message}`);
    }
  }

  console.log(`  [github] Total unique repos found: ${seenRepos.size}`);

  // --- Phase 3: Fetch README and extract endpoints for each repo ---
  for (const repoFullName of seenRepos) {
    try {
      const branch = 'main'; // Try main, fall back to master
      let readme: string;
      try {
        readme = await fetchRaw(`https://raw.githubusercontent.com/${repoFullName}/${branch}/README.md`, token);
      } catch {
        try {
          readme = await fetchRaw(`https://raw.githubusercontent.com/${repoFullName}/master/README.md`, token);
        } catch {
          continue;
        }
      }

      const urls = extractUrls(readme);
      const addresses = readme.match(WALLET_PATTERN) || [];
      const repoName = repoFullName.split('/').pop() || repoFullName;

      // Fetch repo info for description
      let description = '';
      try {
        const repoInfo = await fetchJson(`https://api.github.com/repos/${repoFullName}`, token);
        description = repoInfo.description || '';
      } catch { /* skip */ }

      if (urls.length > 0) {
        for (const url of urls) {
          agents.push({
            name: repoName,
            endpoint: url,
            address: addresses[0],
            repoUrl: `https://github.com/${repoFullName}`,
            description,
          });
        }
      } else {
        // Record x402 project even without deployed URL
        if (
          readme.toLowerCase().includes('x402') ||
          readme.toLowerCase().includes('erc-8004')
        ) {
          agents.push({
            name: repoName,
            endpoint: '',
            address: addresses[0],
            repoUrl: `https://github.com/${repoFullName}`,
            description: description || 'x402 project (no deployed endpoint found)',
          });
        }
      }

      await sleep(500); // Be polite to raw.githubusercontent.com
    } catch { /* skip */ }
  }

  // Deduplicate by endpoint or repoUrl
  const seen = new Set<string>();
  const unique = agents.filter(a => {
    const key = a.endpoint || a.repoUrl;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[github] Found ${unique.length} agent(s) from GitHub (${seenRepos.size} repos searched)`);
  return unique;
}
