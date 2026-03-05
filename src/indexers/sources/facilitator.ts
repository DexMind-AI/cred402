import { createPublicClient, http, parseAbiItem, type Address, type Log } from 'viem';
import { base } from 'viem/chains';

export interface FacilitatorAgent {
  address: string;
  source: string;
  txHash?: string;
}

/**
 * x402 Permit2 Proxy contracts on Base mainnet.
 * Deployed via CREATE2 — same address on all EVM chains.
 * Source: https://github.com/coinbase/x402/tree/main/contracts/evm
 */
const EXACT_PROXY = '0x4020cd856c882d5fb903d99ce35316a085bb0001' as Address;
const UPTO_PROXY = '0x40204513ec14919adfd30d77c0a991371b420002' as Address;

// USDC on Base
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;

// ERC-20 Transfer event
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

// The proxy contracts emit Settled() when they process a payment.
// The actual fund flow is: payer -> payTo via Permit2 Transfer.
// We scan USDC Transfer events FROM the Permit2 contract or payer TO the payee,
// where the transaction involves our proxy contracts.
//
// Simpler approach: scan for Settled() events on the proxy contracts,
// then for each tx, look at the Transfer events to find the payee.

const SETTLED_EVENT = parseAbiItem('event Settled()');
const SETTLED_WITH_PERMIT_EVENT = parseAbiItem('event SettledWithPermit()');

/**
 * Crawl x402 facilitator (Permit2 proxy) contracts on Base for payment recipients.
 * These are x402 service providers who have received real payments.
 */
export async function crawlFacilitator(
  rpcUrl: string = 'https://mainnet.base.org'
): Promise<FacilitatorAgent[]> {
  console.log('[facilitator] Starting x402 facilitator contract scan on Base...');
  console.log(`  [facilitator] Exact proxy: ${EXACT_PROXY}`);
  console.log(`  [facilitator] Upto proxy:  ${UPTO_PROXY}`);

  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  const payees = new Map<string, FacilitatorAgent>();

  try {
    const currentBlock = await client.getBlockNumber();
    // Scan last 500k blocks (~12 days on Base at ~2s blocks)
    const SCAN_RANGE = 500000n;
    const startBlock = currentBlock > SCAN_RANGE ? currentBlock - SCAN_RANGE : 0n;
    const CHUNK_SIZE = 10000n;

    console.log(`  [facilitator] Scanning blocks ${startBlock}–${currentBlock}...`);

    // Scan both proxy contracts for Settled events
    for (const proxyAddress of [EXACT_PROXY, UPTO_PROXY]) {
      const proxyName = proxyAddress === EXACT_PROXY ? 'Exact' : 'Upto';

      for (let from = startBlock; from <= currentBlock; from += CHUNK_SIZE) {
        const to = from + CHUNK_SIZE - 1n > currentBlock ? currentBlock : from + CHUNK_SIZE - 1n;

        try {
          // Get Settled() events from the proxy
          const settledLogs = await client.getLogs({
            address: proxyAddress,
            event: SETTLED_EVENT,
            fromBlock: from,
            toBlock: to,
          });

          const settledWithPermitLogs = await client.getLogs({
            address: proxyAddress,
            event: SETTLED_WITH_PERMIT_EVENT,
            fromBlock: from,
            toBlock: to,
          });

          const allLogs = [...settledLogs, ...settledWithPermitLogs];

          if (allLogs.length > 0) {
            console.log(`  [facilitator] ${proxyName}: Found ${allLogs.length} settlement(s) in blocks ${from}–${to}`);

            // For each settlement tx, get the USDC Transfer events to find payee
            for (const log of allLogs) {
              try {
                const receipt = await client.getTransactionReceipt({ hash: log.transactionHash });
                // Find USDC Transfer events in the same tx
                for (const rLog of receipt.logs) {
                  if (
                    rLog.address.toLowerCase() === USDC_BASE.toLowerCase() &&
                    rLog.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' && // Transfer topic
                    rLog.topics[2] // has 'to' field
                  ) {
                    const toAddress = ('0x' + rLog.topics[2].slice(26)) as Address;
                    // Exclude transfers to the proxy itself or known infrastructure
                    if (
                      toAddress.toLowerCase() !== proxyAddress.toLowerCase() &&
                      toAddress.toLowerCase() !== USDC_BASE.toLowerCase()
                    ) {
                      if (!payees.has(toAddress.toLowerCase())) {
                        payees.set(toAddress.toLowerCase(), {
                          address: toAddress.toLowerCase(),
                          source: `x402-facilitator-${proxyName.toLowerCase()}`,
                          txHash: log.transactionHash,
                        });
                      }
                    }
                  }
                }
              } catch (err: any) {
                // Skip individual tx errors
                console.log(`  [facilitator] Tx receipt error: ${err.message?.slice(0, 80)}`);
              }
            }
          }
        } catch (err: any) {
          // Skip chunk on error (RPC rate limits etc)
          if (!err.message?.includes('no matching logs')) {
            console.log(`  [facilitator] ${proxyName} chunk ${from}–${to}: ${err.message?.slice(0, 100)}`);
          }
        }
      }
    }
  } catch (err: any) {
    console.error(`  [facilitator] Scan failed: ${err.message}`);
  }

  const agents = Array.from(payees.values());
  console.log(`[facilitator] Found ${agents.length} unique payee address(es) from x402 settlements`);
  return agents;
}
