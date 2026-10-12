import { buildApp, getHostConfig } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp({ dataDir: config.dataDir, logger: true });
const host = getHostConfig(app.db);
const address = host.bindAddress === '*' ? '0.0.0.0' : host.bindAddress;

await app.listen({ host: address, port: config.port });
app.log.info(`Sonarr listening on http://${address}:${config.port}`);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
