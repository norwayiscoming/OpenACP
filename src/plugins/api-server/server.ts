import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyRateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { globalErrorHandler } from './middleware/error-handler.js';
import { createAuthPreHandler } from './middleware/auth.js';

export interface ApiServerOptions {
  port: number;
  host: string;
  getSecret: () => string;
  getJwtSecret: () => string;
  tokenStore: import('./auth/token-store.js').TokenStore;
  logger?: boolean;
}

export interface ApiServerInstance {
  app: FastifyInstance;
  start(): Promise<{ port: number; host: string }>;
  stop(): Promise<void>;
  registerPlugin(prefix: string, plugin: FastifyPluginAsync, opts?: { auth?: boolean }): void;
}

export async function createApiServer(options: ApiServerOptions): Promise<ApiServerInstance> {
  const app = Fastify({ logger: options.logger ?? false, forceCloseConnections: true });

  // Zod validation
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // CORS — allow any origin (auth is Bearer token, not cookie-based).
  // Do NOT set Access-Control-Allow-Credentials: credentials mode is not needed
  // for Bearer token auth and reflecting the origin with credentials: true is a
  // well-known CORS misconfiguration that could allow cross-origin credential abuse.
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin);
    }
    if (request.method === 'OPTIONS') {
      reply.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      reply.status(204).send();
    }
  });

  // Plugins
  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    // When the server is reachable through a tunnel (Cloudflare, ngrok, etc.) all
    // requests arrive from the same tunnel-proxy IP address.  Use the real client IP
    // from well-known forwarded headers so rate limits are enforced per-caller, not
    // per-tunnel.  Only the first value in X-Forwarded-For is taken (the client); the
    // rest may be added by intermediate proxies and must not be trusted for limiting.
    keyGenerator: (request) => {
      const cfIp = request.headers['cf-connecting-ip'];
      if (cfIp && typeof cfIp === 'string') return cfIp;
      const xff = request.headers['x-forwarded-for'];
      if (xff) {
        const first = (Array.isArray(xff) ? xff[0] : xff).split(',')[0]?.trim();
        if (first) return first;
      }
      return request.ip;
    },
  });
  await app.register(fastifySwagger, {
    openapi: {
      info: { title: 'OpenACP API', version: '1.0.0' },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/api/docs' });

  // Global error handler
  app.setErrorHandler(globalErrorHandler);

  // Backward-compatible redirects: /api/* → /api/v1/*
  app.addHook('onRequest', async (request, reply) => {
    const url = request.url;
    if (url.startsWith('/api/') && !url.startsWith('/api/v1/') && !url.startsWith('/api/docs')) {
      const newUrl = url.replace('/api/', '/api/v1/');
      return reply.redirect(newUrl, 308);
    }
  });

  // Auth pre-handler
  const authPreHandler = createAuthPreHandler(options.getSecret, options.getJwtSecret, options.tokenStore);

  // Decorate request with auth object
  app.decorateRequest('auth', null, []);

  return {
    app,

    registerPlugin(prefix: string, plugin: FastifyPluginAsync, opts?: { auth?: boolean }) {
      const wrappedPlugin: FastifyPluginAsync = async (pluginApp, pluginOpts) => {
        if (opts?.auth !== false) {
          pluginApp.addHook('onRequest', authPreHandler);
        }
        await plugin(pluginApp, pluginOpts);
      };
      app.register(wrappedPlugin, { prefix });
    },

    async start() {
      await app.ready();

      // Auto-detect available port: retry +1 until a free port is found
      let port = options.port;

      while (port <= 65535) {
        try {
          const address = await app.listen({ port, host: options.host });
          const url = new URL(address);
          return { port: Number(url.port), host: url.hostname };
        } catch (err: any) {
          if (err?.code === 'EADDRINUSE' && port < 65535) {
            console.log(`[api-server] Port ${port} in use, trying ${port + 1}...`);
            port++;
            continue;
          }
          throw err;
        }
      }
      throw new Error('No available ports found');
    },

    async stop() {
      await app.close();
    },
  };
}
