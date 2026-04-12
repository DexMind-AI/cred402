export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgres://cred402:cred402@localhost:5432/cred402',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  baseRpcUrl: process.env.BASE_RPC_URL || 'https://sepolia.base.org',
  treasuryAddress: (process.env.CRED402_TREASURY_ADDRESS || '0xD6Ae8D2F816EE123E77D1D698f8a3873A563CB5F') as `0x${string}`,

  // Constants — Base mainnet for x402 facilitator compatibility
  usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
  erc8004Registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as `0x${string}`,
  network: 'base-sepolia' as const,

  // Scoring
  scoreCacheTtlSeconds: 6 * 60 * 60, // 6 hours
  freeTierLimit: parseInt(process.env.FREE_TIER_LIMIT || '100', 10),

  // x402 pricing (in USDC smallest units, 6 decimals)
  // 1000 = $0.001
  priceUsdc: '1000',
} as const;