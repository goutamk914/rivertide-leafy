#!/usr/bin/env node
/**
 * Bundles the Electron main process and the preload with esbuild:
 *   src/main/index.ts    → dist-electron/main.cjs
 *   src/preload/index.ts → dist-electron/preload.cjs   (sandboxed: may only require 'electron')
 *   src/main/wake/worker.ts → dist-electron/wake-worker.cjs ("Hey Leafy" utility process)
 * Everything except `electron` is bundled (workspace packages and npm deps included), because the
 * packaged app ships only dist/ and dist-electron/. Tray/app icons are copied to dist-electron/icons.
 *
 * Usage: node scripts/build-main.mjs [--watch] [--dev]
 *   --watch  rebuild on change (implies --dev unless NODE_ENV is set)
 *   --dev    define process.env.NODE_ENV = "development" (default "production")
 */
import { build, context } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = join(APP_DIR, 'dist-electron');
const SHARED_DIR = join(APP_DIR, 'src/shared');
const RESOURCES_DIR = join(APP_DIR, 'resources');
const ICON_FILES = ['icon.png', 'tray.png', 'tray@2x.png', 'trayTemplate.png', 'trayTemplate@2x.png'];

/** Resolves `@shared/<file>` the same way tsconfig `paths` does. */
const sharedAliasPlugin = {
  name: 'rivertide-shared-alias',
  setup(builder) {
    builder.onResolve({ filter: /^@shared\// }, async (args) => {
      const result = await builder.resolve(`./${args.path.slice('@shared/'.length)}`, {
        resolveDir: SHARED_DIR,
        kind: args.kind,
      });
      if (result.errors.length > 0) return { errors: result.errors };
      return { path: result.path };
    });
  },
};

async function copyIcons() {
  const target = join(OUT_DIR, 'icons');
  await mkdir(target, { recursive: true });
  const missing = [];
  for (const name of ICON_FILES) {
    const source = join(RESOURCES_DIR, name);
    if (!existsSync(source)) {
      missing.push(name);
      continue;
    }
    await copyFile(source, join(target, name));
  }
  if (missing.length > 0) {
    process.stderr.write(`build-main: missing icons (${missing.join(', ')}); run "node scripts/make-icons.mjs"\n`);
  }
}

/** Reports every finished build (initial and watch rebuilds) and keeps icons in place. */
const lifecyclePlugin = (onEnd) => ({
  name: 'rivertide-lifecycle',
  setup(builder) {
    builder.onEnd(async (result) => {
      if (result.errors.length === 0) await copyIcons();
      onEnd?.(result);
    });
  },
});

/** Lets bundled ESM dependencies that read `import.meta.url` work inside the CommonJS main bundle. */
const IMPORT_META_URL = '__rivertideImportMetaUrl';
const IMPORT_META_BANNER = `"use strict";\nconst ${IMPORT_META_URL} = require("node:url").pathToFileURL(__filename).href;`;

/** Options for both bundles: [main, preload]. */
export function buildOptions({ mode, onEnd } = {}) {
  const nodeEnv = mode ?? 'production';
  const shared = {
    absWorkingDir: APP_DIR,
    outdir: OUT_DIR,
    outExtension: { '.js': '.cjs' },
    bundle: true,
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    sourcemap: true,
    tsconfig: join(APP_DIR, 'tsconfig.node.json'),
    define: { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) },
    logLevel: 'info',
  };
  const main = {
    ...shared,
    entryPoints: { main: 'src/main/index.ts' },
    platform: 'node',
    banner: { js: IMPORT_META_BANNER },
    define: { ...shared.define, 'import.meta.url': IMPORT_META_URL },
    plugins: [sharedAliasPlugin, lifecyclePlugin(onEnd)],
  };
  // The sandboxed preload may only require 'electron': the browser platform makes any Node
  // built-in import a build error instead of a blank window at runtime.
  const preload = {
    ...shared,
    entryPoints: { preload: 'src/preload/index.ts' },
    platform: 'browser',
    plugins: [sharedAliasPlugin, lifecyclePlugin(onEnd)],
  };
  // The "Hey Leafy" utility process. onnxruntime-node is a native module: never bundled, it is
  // required at run time (node_modules in development, Resources/node_modules when packaged).
  const wakeWorker = {
    ...main,
    entryPoints: { 'wake-worker': 'src/main/wake/worker.ts' },
    external: ['electron', 'onnxruntime-node'],
  };
  return [main, preload, wakeWorker];
}

/**
 * One-shot build, or (with `watch`) watching contexts; returns `{ dispose }`.
 * `onEnd(result)` fires after every build of either bundle, including rebuilds.
 */
export async function buildMain({ watch = false, mode, onEnd } = {}) {
  const resolvedMode = mode ?? (watch ? 'development' : 'production');
  const allOptions = buildOptions({ mode: resolvedMode, onEnd });
  if (!watch) {
    await Promise.all(allOptions.map((options) => build(options)));
    return { dispose: async () => {} };
  }
  const contexts = await Promise.all(allOptions.map((options) => context(options)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  return { dispose: () => Promise.all(contexts.map((ctx) => ctx.dispose())) };
}

function parseArgs(argv) {
  const watch = argv.includes('--watch');
  const dev = argv.includes('--dev');
  const envMode = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'production' ? process.env.NODE_ENV : null;
  return { watch, mode: dev ? 'development' : envMode ?? (watch ? 'development' : 'production') };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  buildMain(args).catch((error) => {
    process.stderr.write(`build-main failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
