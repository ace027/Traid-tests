import { buildApp, getHostConfig } from './app.js';
import { loadConfig, resolveListenOptions } from './config.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig();
const app = await buildApp({ dataDir: config.dataDir, logger: true });
const host = getHostConfig(app.db);
const listen = resolveListenOptions(host);

try {
  await app.listen(listen);
  app.log.info(`Sonarr listening on http://${listen.host}:${listen.port}${host.urlBase}`);
} catch (err) {
  app.log.error(err, 'Failed to start the server');
  await app.close().catch(() => {});
  process.exit(1);
}

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`${signal} received, shutting down`);
  const timer = setTimeout(() => {
    app.log.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timer.unref();
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'Error during shutdown');
    process.exit(1);
  }
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
