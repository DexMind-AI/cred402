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
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON from ${url}: ${data.slice(0, 200)}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function fetchRaw(url: string, token?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'User-Agent': 'cred402-indexer/1.0',
    };
    if (token) headers['Authorization'] = `token ${token}`;

    const parsed = new URL(url);
    const lib = url.startsWith('https://') ? https : require('http');
    lib.get({
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

const DEPLOYED_URL_PATTERN = /https?:\/\/[^\s)"']+(?:\.fly\.dev|\.railway\.app|\.vercel\.app|\.onrender\.com|\.netlify\.app|\.herokuapp\.com|\.up\.railway\.app)[^\s)"']*/g;

const WALLET_PATTERN = /0x[a-fA-F0-9]{40}/g;

/**
 * Search GitHub for x402 implementations and extract deployed endpoints.
 */
export async function crawlGitHub(token?: string): Promise<GitHubAgent[]> {
  console.log('[github] Starting GitHub search...');
  const agents: GitHubAgent[] = [];

  const queries = [
    '@coinbase/x402',
    'x402 express middleware',
    'x402 payment required',
    'x402/express',
    'x402/next',
    'erc-8004 agent',
  ];

  const seenRepos = new Set<string>();

  for (const query of queries) {
    try {
      console.log(`  [github] Searching: "${query}"...`);
      const encoded = encodeURIComponent(query);
      const searchUrl = `https://api.github.com/search/code?q=${encoded}&per_page=30`;

      let results: any;
      try {
        results = await fetchJson(searchUrl, token);
      } catch (err: any) {
        // Fall back to repo search if code search fails
        const repoSearchUrl = `https://api.github.com/search/repositories?q=${encoded}&per_page=20&sort=updated`;
        results = await fetchJson(repoSearchUrl, token);
      }

      if (results.message) {
        console.log(`  [github] API message: ${results.message}`);
        if (results.message.includes('rate limit')) {
          console.log('  [github] Rate limited, stopping search');
          break;
        }
        continue;
      }

      const items = results.items || [];
      for (const item of items) {
        const repoFullName = item.repository?.full_name || item.full_name;
        if (!repoFullName || seenRepos.has(repoFullName)) continue;
        seenRepos.add(repoFullName);

        try {
          // Fetch README to find deployed URLs
          const readmeUrl = `https://raw.githubusercontent.com/${repoFullName}/main/README.md`;
          let readme: string;
          try {
            readme = await fetchRaw(readmeUrl, token);
          } catch {
            // Try master branch
            readme = await fetchRaw(
              `https://raw.githubusercontent.com/${repoFullName}/master/README.md`,
              token
            );
          }

          // Find deployed URLs
          const urls = readme.match(DEPLOYED_URL_PATTERN) || [];
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

          // Even repos without deployed URLs are worth noting if they're x402 related
          if (urls.length === 0) {
            // Check if they have a package.json with x402 deps
            try {
              const pkgJson = await fetchRaw(
                `https://raw.githubusercontent.com/${repoFullName}/main/package.json`,
                token
              );
              const pkg = JSON.parse(pkgJson);
              const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
              if (allDeps['@coinbase/x402'] || allDeps['@x402/express'] || allDeps['@x402/next']) {
                // It's a real x402 project, just no deployed URL found
                agents.push({
                  name: repoFullName.split('/').pop() || repoFullName,
                  endpoint: '',
                  address: addresses[0],
                  repoUrl: `https://github.com/${repoFullName}`,
                  description: item.description || `x402 project (no deployed endpoint found)`,
                });
              }
            } catch { /* skip */ }
          }
        } catch { /* skip repos we can't read */ }
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 1000));
    } catch (err: any) {
      console.log(`  [github] Search error for "${query}": ${err.message}`);
    }
  }

  // Deduplicate by endpoint (or by repoUrl for no-endpoint entries)
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
