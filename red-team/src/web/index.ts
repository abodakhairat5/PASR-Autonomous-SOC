#!/usr/bin/env node

// PARS Web Platform entry point.
// Starts the Fastify backend server with SQLite persistence and SSE event streaming.

import { startWebServer } from './server/index.js';

const host = process.env.PARS_WEB_HOST ?? '0.0.0.0';
const port = Number(process.env.PARS_WEB_PORT ?? '3001');

startWebServer({ host, port }).catch((err) => {
  console.error('Failed to start web server:', err);
  process.exit(1);
});
