import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import fastifyCors from '@fastify/cors';
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

  // Plugins
  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (curl, native apps) or localhost
      if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    credentials: true,
  });
  await app.register(fastifyRateLimit, { max: 100, timeWindow: '1 minute' });
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

      // Auto-detect available port: retry +1 up to 10 times on EADDRINUSE
      const maxRetries = 10;
      let port = options.port;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const address = await app.listen({ port, host: options.host });
          const url = new URL(address);
          return { port: Number(url.port), host: url.hostname };
        } catch (err: any) {
          if (err?.code === 'EADDRINUSE' && attempt < maxRetries && port < 65535) {
            console.log(`[api-server] Port ${port} in use, trying ${port + 1}...`);
            port++;
            continue;
          }
          throw err;
        }
      }
      throw new Error(`All ports ${options.port}-${port} in use`);
    },

    async stop() {
      await app.close();
    },
  };
}
