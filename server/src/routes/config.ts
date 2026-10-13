import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { hostConfigUpdateSchema, uiConfigSchema, validationError, type HostConfig } from '@sonarr/shared';
import { schema } from '../db/index.js';
import { getHostConfig } from '../app.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../services/auth.js';
import { generateApiKey } from '../services/hostConfig.js';
import { getUiConfig } from '../services/seed.js';

const uiUpdateSchema = uiConfigSchema.partial();

export async function configRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v3/config/host', async () => getHostConfig(app.db));

  app.put('/api/v3/config/host', async (req) => {
    const body = hostConfigUpdateSchema.parse(req.body);
    const current = getHostConfig(app.db);
    // The API key and id are never changed through PUT; the password is write-only.
    const { password = '', apiKey: _apiKey, id: _id, ...changes } = body;
    const next: HostConfig = { ...current, ...changes, id: 1, apiKey: current.apiKey, password: '' };

    if (password && password.length < MIN_PASSWORD_LENGTH) {
      throw validationError('password', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const hasPassword = app.auth.settings().hasPassword;
    // Switching to forms must not leave the instance open to whoever completes first-run setup.
    const switchingToForms = current.authenticationMethod !== 'forms' && next.authenticationMethod === 'forms';
    if (switchingToForms && !hasPassword && !password) {
      throw validationError('password', 'Password is required for forms authentication');
    }
    const needsUsername = Boolean(password) || switchingToForms || (hasPassword && next.authenticationMethod === 'forms');
    if (needsUsername && !next.username) throw validationError('username', 'Username is required');

    const credentialsChanged = Boolean(password) || next.username !== current.username;
    const hash = password ? await hashPassword(password) : null;
    const saved = app.updateHostConfig(() => next);
    if (hash) app.auth.storePasswordHash(hash);
    // New credentials end every other session; the caller's own session (if any) survives.
    if (credentialsChanged) app.auth.revokeAllSessions(req.auth?.sessionToken);
    return saved;
  });

  app.post('/api/v3/config/host/apikey/reset', async () =>
    app.updateHostConfig((host) => ({ ...host, apiKey: generateApiKey() })),
  );

  app.get('/api/v3/config/ui', async () => getUiConfig(app.db));

  app.put('/api/v3/config/ui', async (req) => {
    const body = uiUpdateSchema.parse(req.body);
    const next = { ...getUiConfig(app.db), ...body, id: 1 as const };
    app.db
      .insert(schema.config)
      .values({ key: 'ui', value: JSON.stringify(next) })
      .onConflictDoUpdate({ target: schema.config.key, set: { value: JSON.stringify(next) } })
      .run();
    app.events.publish('uiconfig', 'updated', next);
    return next;
  });
}
