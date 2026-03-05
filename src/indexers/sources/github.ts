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

const DEPLOYED_URL_PATTERN = /https?:\/\/[^\s)"'`]+(?:\.fly\.dev|\.railway\.app|\.vercel\.app|\.onrender\.com|\.netlify\.app|\.herokuapp\.com|\.up\.railway\.app)[^\s)"'`]*/g;
const WALLET_PATTERN = /0x[a-fA-F0-9]{40}/g;

/** Filter out template/placeholder URLs */
function isRealUrl(url: string): boolean {
  return !/<|>|\{|\}|\$|`|your-|example|placeholder|PROJECT|APP_NAME/i.test(url);
}

/**
 * Search GitHub for x402 implementations using REPO search (no auth required).
 */
export async function crawlGitHub(token?: string): Promise<GitHubAgent[]> {
  console.log('[github] Starting GitHub repo search...');
  const agents: GitHubAgent[] = [];
  const seenRepos = new Set<string>();

  const queries = [
    'x402 in:name,description,readme',
    'x402 express',
    'x402 payment',
    'erc-8004 agent',
    'coinbase x402',
  ];

  for (const query of queries) {
    try {
      console.log(`  [github] Searching repos: "${query}"...`);
      const encoded = encodeURIComponent(query);
      const searchUrl = `https://api.github.com/search/repositories?q=${encoded}&per_page=20&sort=updated`;

      const results = await fetchJson(searchUrl, token);

      if (results.message) {
        console.log(`  [github] API: ${results.message}`);
        if (results.message.includes('rate limit')) break;
        continue;
      }

      const items = results.items || [];
      console.log(`  [github] Got ${items.length} repo(s)`);

      for (const item of items) {
        const repoFullName = item.full_name;
        if (!repoFullName || seenRepos.has(repoFullName)) continue;
        seenRepos.add(repoFullName);

        try {
          const branch = item.default_branch || 'main';
          let readme: string;
          try {
            readme = await fetchRaw(`https://raw.githubusercontent.com/${repoFullName}/${branch}/README.md`, token);
          } catch {
            continue;
          }

          const urls = (readme.match(DEPLOYED_URL_PATTERN) || []).filter(isRealUrl);
          const addresses = readme.match(WALLET_PATTERN) || [];

          for (const rawUrl of [...new Set(urls)]) {
            const url = rawUrl.replace(/[.,;:!?)]+$/, '');
            agents.push({
              name: repoFullName.split('/').pop() || repoFullName,
              endpoint: url,
              address: addresses[0],
              repoUrl: `https://github.com/${repoFullName}`,
              description: item.description,
            });
          }

          // Record x402 projects even without deployed URLs
          if (urls.length === 0 && (
            readme.toLowerCase().includes('x402') ||
            readme.toLowerCase().includes('erc-8004')
          )) {
            agents.push({
              name: repoFullName.split('/').pop() || repoFullName,
              endpoint: '',
              address: addresses[0],
              repoUrl: `https://github.com/${repoFullName}`,
              description: item.description || 'x402 project (no deployed endpoint)',
            });
          }
        } catch { /* skip */ }
      }

      await new Promise(r => setTimeout(r, 2000));
    } catch (err: any) {
      console.log(`  [github] Search error: ${err.message}`);
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = agents.filter(a => {
    const key = a.endpoint || a.repoUrl;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[github] Found ${unique.length} agent(s) from GitHub`);
  return unique;
}
