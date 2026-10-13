import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthenticationMethod } from '@sonarr/shared';
import { resolveAuth } from '../plugins/auth.js';
import { hashPassword, MIN_PASSWORD_LENGTH, parseCookies, serializeSessionCookie, SESSION_COOKIE, type AuthService } from '../services/auth.js';

export interface AuthRouteOptions {
  auth: AuthService;
  version: string;
  getInstanceName: () => string;
}

export interface InitializeResponse {
  urlBase: string;
  instanceName: string;
  version: string;
  authMethod: AuthenticationMethod;
  setupRequired: boolean;
  authenticated: boolean;
  /** Non-empty only when the request is authorized. */
  apiKey: string;
}

const loginSchema = z.object({
  username: z.string().max(256),
  password: z.string().max(1024),
  rememberMe: z.boolean().optional(),
});

const setupSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(256),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`).max(1024),
});

export async function authRoutes(app: FastifyInstance, opts: AuthRouteOptions): Promise<void> {
  const { auth } = opts;
  const cookiePath = () => auth.settings().urlBase || '/';

  const startSession = (request: FastifyRequest, reply: FastifyReply, rememberMe: boolean) => {
    const session = auth.createSession(rememberMe);
    reply.header(
      'set-cookie',
      serializeSessionCookie(session.token, {
        path: cookiePath(),
        maxAgeSeconds: session.maxAgeSeconds,
        secure: request.protocol === 'https',
      }),
    );
  };

  app.addHook('onSend', async (request, reply) => {
    const route = request.routeOptions.url;
    if (route === '/initialize.json' || route === '/login' || route === '/logout' || route === '/initialize/setup') {
      reply.header('cache-control', 'no-store');
    }
  });

  app.get('/initialize.json', async (request): Promise<InitializeResponse> => {
    const settings = auth.settings();
    const authorized = resolveAuth(auth, request).via !== null;
    return {
      urlBase: settings.urlBase,
      instanceName: opts.getInstanceName(),
      version: opts.version,
      authMethod: settings.method,
      setupRequired: auth.setupRequired(),
      authenticated: authorized,
      apiKey: authorized ? settings.apiKey : '',
    };
  });

  app.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const ip = request.ip;
    const retryAfter = auth.limiter.retryAfter(ip);
    if (retryAfter > 0) {
      reply.header('retry-after', String(retryAfter));
      return reply.code(429).send({ message: 'Too many failed login attempts. Try again later.' });
    }
    if (!(await auth.verifyCredentials(body.username, body.password))) {
      auth.limiter.recordFailure(ip);
      request.log.warn({ ip }, 'Failed login attempt');
      return reply.code(401).send({ message: 'Invalid username or password' });
    }
    auth.limiter.reset(ip);
    startSession(request, reply, body.rememberMe ?? false);
    return { authenticated: true };
  });

  app.post('/logout', async (request, reply) => {
    auth.revokeSession(parseCookies(request.headers.cookie).get(SESSION_COOKIE));
    reply.header(
      'set-cookie',
      serializeSessionCookie('', { path: cookiePath(), maxAgeSeconds: 0, secure: request.protocol === 'https' }),
    );
    return { authenticated: false };
  });

  app.post('/initialize/setup', async (request, reply) => {
    if (auth.settings().hasPassword) return reply.code(409).send({ message: 'Setup has already been completed' });
    const body = setupSchema.parse(request.body);
    const hash = await hashPassword(body.password);
    // Re-check after the async hash: the check and the writes below run without yielding.
    auth.invalidate();
    if (auth.settings().hasPassword) return reply.code(409).send({ message: 'Setup has already been completed' });
    app.updateHostConfig((host) => ({ ...host, username: body.username }));
    auth.storePasswordHash(hash);
    auth.revokeAllSessions();
    startSession(request, reply, false);
    return { authenticated: true };
  });
}
