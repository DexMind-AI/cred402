#!/bin/bash
set -e

export PORT=3001
export FREE_TIER_LIMIT=0
export DATABASE_URL=postgres://cred402:cred402@localhost:5432/cred402
export REDIS_URL=redis://localhost:6379
export BASE_RPC_URL=https://mainnet.base.org
export NODE_ENV=test

echo "Starting server on port $PORT..."
npx tsx src/index.ts &
SERVER_PID=$!

# Wait for server to be ready
sleep 3

# Check if server is up
if curl -s http://localhost:$PORT/health > /dev/null; then
    echo "Server is up."
    # Test /v1/score/0x123 (should return 402)
    echo "Testing /v1/score/0x123..."
    curl -v http://localhost:$PORT/v1/score/0x123 2>&1 | grep -E "(HTTP|< x402|402 Payment Required)"
    # Kill server
    kill $SERVER_PID
    wait $SERVER_PID 2>/dev/null
    echo "Test complete."
else
    echo "Server failed to start."
    kill $SERVER_PID 2>/dev/null
    exit 1
fi