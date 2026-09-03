import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import {
  registerEngagementRoutes,
  registerEvidenceRoutes,
  registerFindingRoutes,
  registerHealthRoute,
} from '../api/routes.js';
import { ParsDatabase } from '../persistence/database.js';
import { EventBroadcaster } from '../realtime/broadcaster.js';
import { SessionManager } from './session-manager.js';

export interface WebServerConfig {
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
}

export async function createWebServer(config: WebServerConfig) {
  const app = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  });

  // CORS
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Initialize persistence
  const db = new ParsDatabase(config.dbPath);

  // Initialize real-time broadcasting
  const broadcaster = new EventBroadcaster();

  // Initialize session manager
  const sessionManager = new SessionManager(broadcaster, config.dataDir);

  // Register routes
  registerHealthRoute(app, db, broadcaster);
  registerEngagementRoutes(app, db, sessionManager, broadcaster, config.dataDir);
  registerFindingRoutes(app, db);
  registerEvidenceRoutes(app, db);

  // Serve frontend static files if built
  const frontendDist = resolve(process.cwd(), 'frontend-dist');
  if (existsSync(frontendDist)) {
    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
      decorateReply: false,
    });

    // SPA fallback: serve index.html for non-API routes
    const indexHtml = readFileSync(resolve(frontendDist, 'index.html'), 'utf-8');
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.type('text/html').send(indexHtml);
    });
  }

  // Graceful shutdown
  app.addHook('onClose', async () => {
    db.close();
  });

  return { app, db, broadcaster, sessionManager };
}

export async function startWebServer(config?: Partial<WebServerConfig>) {
  const host = config?.host ?? process.env.PARS_WEB_HOST ?? '0.0.0.0';
  const port = config?.port ?? Number(process.env.PARS_WEB_PORT ?? '3001');
  const dataDir =
    config?.dataDir ?? process.env.PARS_DATA_DIR ?? resolve(process.cwd(), '.pars-data');
  const dbPath = config?.dbPath ?? process.env.PARS_DATABASE_URL ?? resolve(dataDir, 'pars.db');

  const { app } = await createWebServer({ host, port, dataDir, dbPath });

  try {
    await app.listen({ host, port });
    console.log('\n  PARS Web Platform');
    console.log('  ─────────────────');
    console.log(`  Local:   http://localhost:${port}`);
    console.log(`  Network: http://${host}:${port}`);
    console.log(`  Health:  http://localhost:${port}/api/health\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  return app;
}
