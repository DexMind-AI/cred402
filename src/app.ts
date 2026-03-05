import express from 'express';
import scoreRouter from './routes/score';
import profileRouter from './routes/profile';
import statusRouter from './routes/status';
import registerRouter from './routes/register';

export function createApp() {
  const app = express();

  app.use(express.json());

  // Trust proxy for IP-based rate limiting on fly.io
  app.set('trust proxy', true);

  // Routes
  app.use('/v1/score', scoreRouter);
  app.use('/v1/profile', profileRouter);
  app.use('/v1/status', statusRouter);
  app.use('/v1/register', registerRouter);

  // Root redirect
  app.get('/', (_req, res) => {
    res.json({
      name: 'Cred402',
      description: 'x402-native TrustScore API for ERC-8004 AI agents',
      docs: '/v1/status',
      endpoints: {
        score: 'GET /v1/score/:agent',
        profile: 'GET /v1/profile/:agent',
        status: 'GET /v1/status',
        register: 'POST /v1/register',
      },
    });
  });

  return app;
}
