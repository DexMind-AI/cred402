import { createPublicClient, http, parseAbi, type Address } from 'viem';
import { base } from 'viem/chains';

export interface ERC8004Agent {
  address: string;
  agentId: string;
  name: string;
  endpoint: string;
  registeredAt: number;
}

// ERC-8004 Identity Registry ABI - both for reading and event scanning
const REGISTRY_ABI = parseAbi([
  'function getAgent(address agent) view returns (uint256 agentId, string name, string endpoint, uint256 registeredAt)',
  'function isRegistered(address agent) view returns (bool)',
  'function totalAgents() view returns (uint256)',
  'event AgentRegistered(address indexed agent, uint256 indexed agentId, string name, string endpoint)',
  'event AgentUpdated(address indexed agent, string name, string endpoint)',
]);

/**
 * Crawl the ERC-8004 Identity Registry on Base mainnet for registered agents.
 */
export async function crawlERC8004(
  registryAddress: string = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  rpcUrl: string = 'https://mainnet.base.org'
): Promise<ERC8004Agent[]> {
  console.log('[erc8004] Starting on-chain crawl...');
  console.log(`  [erc8004] Registry: ${registryAddress}`);
  console.log(`  [erc8004] RPC: ${rpcUrl}`);

  const agents: ERC8004Agent[] = [];

  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  // Strategy 1: Try to get totalAgents and iterate
  try {
    const totalAgents = await client.readContract({
      address: registryAddress as Address,
      abi: REGISTRY_ABI,
      functionName: 'totalAgents',
    });

    console.log(`  [erc8004] Registry reports ${totalAgents} total agent(s)`);

    if (totalAgents > 0n) {
      console.log(`  [erc8004] Note: Cannot iterate without getAgentByIndex, falling back to event scan`);
    }
  } catch (err: any) {
    console.log(`  [erc8004] totalAgents() not available: ${err.message?.slice(0, 100)}`);
  }

  // Strategy 2: Scan for AgentRegistered events
  try {
    const currentBlock = await client.getBlockNumber();
    // Scan last 500k blocks (~2 weeks on Base)
    const fromBlock = currentBlock > 500000n ? currentBlock - 500000n : 0n;

    console.log(`  [erc8004] Scanning events from block ${fromBlock} to ${currentBlock}...`);

    const logs = await client.getLogs({
      address: registryAddress as Address,
      event: REGISTRY_ABI[3], // AgentRegistered event
      fromBlock,
      toBlock: currentBlock,
    });

    console.log(`  [erc8004] Found ${logs.length} AgentRegistered event(s)`);

    for (const log of logs) {
      const args = log.args as any;
      if (args) {
        agents.push({
          address: args.agent || '',
          agentId: (args.agentId || 0n).toString(),
          name: args.name || '',
          endpoint: args.endpoint || '',
          registeredAt: 0, // Would need block timestamp
        });
      }
    }

    // Also scan for AgentUpdated to get latest info
    try {
      const updateLogs = await client.getLogs({
        address: registryAddress as Address,
        event: REGISTRY_ABI[4], // AgentUpdated event
        fromBlock,
        toBlock: currentBlock,
      });

      for (const log of updateLogs) {
        const args = log.args as any;
        if (args?.agent) {
          const existing = agents.find(a => a.address.toLowerCase() === args.agent.toLowerCase());
          if (existing) {
            if (args.name) existing.name = args.name;
            if (args.endpoint) existing.endpoint = args.endpoint;
          }
        }
      }
    } catch { /* AgentUpdated may not exist */ }

  } catch (err: any) {
    console.log(`  [erc8004] Event scan failed: ${err.message?.slice(0, 200)}`);
  }

  // Strategy 3: Check some well-known agent addresses
  const knownAddresses: Address[] = [
    '0xD6Ae8D2F816EE123E77D1D698f8a3873A563CB5F', // cred402 treasury
  ];

  for (const addr of knownAddresses) {
    try {
      const isRegistered = await client.readContract({
        address: registryAddress as Address,
        abi: REGISTRY_ABI,
        functionName: 'isRegistered',
        args: [addr],
      });

      if (isRegistered) {
        const result = await client.readContract({
          address: registryAddress as Address,
          abi: REGISTRY_ABI,
          functionName: 'getAgent',
          args: [addr],
        }) as [bigint, string, string, bigint];

        agents.push({
          address: addr,
          agentId: result[0].toString(),
          name: result[1],
          endpoint: result[2],
          registeredAt: Number(result[3]),
        });
      }
    } catch { /* skip */ }
  }

  // Deduplicate by address
  const seen = new Set<string>();
  const unique = agents.filter(a => {
    const key = a.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[erc8004] Total unique: ${unique.length} agent(s)`);
  return unique;
}
