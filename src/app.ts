import express from 'express';
import cors from 'cors';
import { freeTierRateLimit } from './middleware/rateLimit';
import { x402PaymentGate } from './middleware/x402';
import scoreRouter from './routes/score';
import profileRouter from './routes/profile';
import statusRouter from './routes/status';
import registerRouter from './routes/register';
import leaderboardRouter from './routes/leaderboard';

export function createApp() {
  const app = express();

  // CORS — allow landing pages, browsers, and x402 clients
  app.use(cors({
    origin: [
      'https://cred402.forge.dexmind.ai',
      'https://cred402.com',
      'https://www.cred402.com',
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-PAYMENT', 'Payment-Signature', 'Authorization'],
    exposedHeaders: ['X-PAYMENT-RESPONSE', 'X-RateLimit-Remaining'],
  }));

  app.use(express.json());

  // Trust proxy for IP-based rate limiting
  app.set('trust proxy', true);

  // Health endpoint (no auth, no payment)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '2.0.0' });
  });

  // Paid endpoints: rate limiter → x402 payment gate → route handler
  app.use('/v1/score', freeTierRateLimit(), x402PaymentGate('score'), scoreRouter);
  app.use('/v1/profile', freeTierRateLimit(), x402PaymentGate('profile'), profileRouter);

  // Free endpoints
  app.use('/v1/status', statusRouter);
  app.use('/v1/register', registerRouter);
  app.use('/v1/leaderboard', leaderboardRouter);

  // Root info
  app.get('/', (_req, res) => {
    res.json({
      name: 'Cred402',
      version: '2.0.0',
      description: 'x402-native TrustScore API for ERC-8004 AI agents',
      docs: '/v1/status',
      x402: {
        version: 1,
        network: 'base',
        asset: 'USDC',
        price: '$0.001',
      },
      endpoints: {
        score: 'GET /v1/score/:agent',
        profile: 'GET /v1/profile/:agent',
        leaderboard: 'GET /v1/leaderboard?limit=100&category=',
        status: 'GET /v1/status',
        register: 'POST /v1/register',
      },
    });
  });

  return app;
}
