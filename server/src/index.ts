import { buildApp, getHostConfig } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp({ dataDir: config.dataDir, logger: true });
const host = getHostConfig(app.db);
const address = host.bindAddress === '*' ? '0.0.0.0' : host.bindAddress;

// SONARR_PORT, when set, overrides the persisted port setting.
const port = process.env.SONARR_PORT ? config.port : host.port;

// Honour the persisted URL base by stripping it before routing.
const urlBase = host.urlBase.replace(/\/+$/, '');
if (urlBase) {
  app.server.prependListener('request', (req) => {
    const url = req.url ?? '';
    if (url === urlBase || url.startsWith(`${urlBase}/`) || url.startsWith(`${urlBase}?`)) {
      req.url = url.slice(urlBase.length) || '/';
    }
  });
}

await app.listen({ host: address, port });
app.log.info(`Sonarr listening on http://${address}:${port}${urlBase}`);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
