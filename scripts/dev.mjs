// Runs the game server and the Vite client together; kills both on exit.
import { spawn } from 'node:child_process';
import net from 'node:net';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port);
  });
}

for (const port of [8787, 5173]) {
  if (!(await portFree(port))) {
    console.error(`[dev] Port ${port} is already in use. Stop the other process and retry.`);
    process.exit(1);
  }
}

const children = [];
let exiting = false;

function shutdown(code) {
  if (exiting) return;
  exiting = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300).unref();
}

function run(prefix, cmd, args) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  children.push(child);
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) out.write(`[${prefix}] ${l}\n`);
    });
    stream.on('end', () => {
      if (buf) out.write(`[${prefix}] ${buf}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('error', (e) => {
    console.error(`[dev] failed to start ${prefix}: ${e.message}`);
    shutdown(1);
  });
  child.on('exit', (code, sig) => {
    if (!exiting) console.error(`[dev] ${prefix} exited (${sig ?? code}); stopping.`);
    shutdown(code ?? 1);
  });
}

run('server', npm, ['run', 'server']);
run('client', npx, ['vite', '--port', '5173', '--strictPort']);

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => shutdown(0));
process.on('exit', () => {
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
});
