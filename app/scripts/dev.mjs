#!/usr/bin/env node
/**
 * `npm run dev`: Vite dev server (renderer, HMR) + esbuild watch (main/preload) + Electron.
 * Electron is restarted whenever the main or preload bundle changes, and every child process
 * is stopped when this script exits (Ctrl+C) or when you quit Rivertide.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { buildMain } from './build-main.mjs';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_PORT = 5317;
const DEV_SERVER_URL = `http://localhost:${DEV_PORT}`;
const RESTART_DEBOUNCE_MS = 250;
const KILL_GRACE_MS = 4000;

const require = createRequire(import.meta.url);
/** The `electron` npm package exports the path to the Electron binary when required from Node. */
const electronBinary = require('electron');

function log(message) {
  process.stdout.write(`\x1b[32m[dev]\x1b[0m ${message}\n`);
}

function electronEnv() {
  // Some terminals (e.g. VS Code's) export ELECTRON_RUN_AS_NODE, which would start Electron as plain Node.
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  return { ...env, NODE_ENV: 'development', RIVERTIDE_DEV_SERVER_URL: DEV_SERVER_URL };
}

function createElectronRunner(onQuit) {
  let child = null;
  let restarting = false;

  const start = () => {
    log('starting Electron');
    const proc = spawn(electronBinary, ['.'], { cwd: APP_DIR, stdio: 'inherit', env: electronEnv() });
    child = proc;
    proc.on('exit', (code, signal) => {
      if (child === proc) child = null;
      if (restarting) {
        restarting = false;
        start();
        return;
      }
      log(`Electron exited (${signal ?? code ?? 0})`);
      onQuit(code ?? 0);
    });
  };

  const stop = (target) => {
    if (!target || target.exitCode !== null) return;
    target.kill('SIGTERM');
    setTimeout(() => {
      if (target.exitCode === null && target.signalCode === null) target.kill('SIGKILL');
    }, KILL_GRACE_MS).unref();
  };

  return {
    restart() {
      if (!child) {
        start();
        return;
      }
      restarting = true;
      log('main bundle changed; restarting Electron');
      stop(child);
    },
    kill() {
      restarting = false;
      stop(child);
    },
  };
}

async function main() {
  const vite = await createServer({
    configFile: join(APP_DIR, 'vite.config.ts'),
    server: { port: DEV_PORT, strictPort: true },
  });
  await vite.listen();
  log(`renderer at ${DEV_SERVER_URL}`);

  let shuttingDown = false;
  let restartTimer = null;
  let watcher = null;

  const shutdown = async (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearTimeout(restartTimer);
    electron.kill();
    await Promise.allSettled([watcher?.dispose(), vite.close()]);
    process.exit(code);
  };

  const electron = createElectronRunner((code) => void shutdown(code));

  watcher = await buildMain({
    watch: true,
    mode: 'development',
    onEnd: (result) => {
      if (shuttingDown || result.errors.length > 0) return;
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => electron.restart(), RESTART_DEBOUNCE_MS);
    },
  });

  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));
  process.on('SIGHUP', () => void shutdown(0));
}

main().catch((error) => {
  process.stderr.write(`dev failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
