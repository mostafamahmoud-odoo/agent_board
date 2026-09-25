import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Emits errors in the shape VS Code's problem matcher detects.
 *
 * NOTE: two copies of this plugin exist in the official docs and they differ.
 * The generator/sample copy omits the `location == null` guard and throws on
 * any esbuild error that carries no location (config errors, resolve failures).
 * This is the bundling-doc version, which has it.
 *
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location == null) return;
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  }
};

/** Shared across both bundles. The problem-matcher plugin must stay LAST. */
const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: 'silent',
  plugins: [esbuildProblemMatcherPlugin]
};

/**
 * Extension host: CommonJS on Node, with `vscode` resolved by the runtime.
 *
 * NOTE the two different Node versions in play. The BUILD toolchain needs
 * Node >= 22 (@vscode/vsce 4 requires it). The RUNTIME is whatever Node the
 * oldest supported VS Code ships — engines.vscode is ^1.85.0, which is
 * Electron 25 / Node 18 — so the emitted bundle targets node18. Raising
 * engines.vscode is what would let this move up, not upgrading the toolchain.
 */
const extensionConfig = {
  ...common,
  entryPoints: ['src/extension/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode']
};

/**
 * Webview: browser ESM, loaded via <script type="module" nonce="...">.
 * ESM (not IIFE) because the CSP forbids innerHTML injection anyway, and it
 * lets esbuild tree-shake rough.js.
 */
const webviewConfig = {
  ...common,
  entryPoints: ['src/webview/main.ts'],
  outfile: 'dist/webview.js',
  platform: 'browser',
  format: 'esm',
  target: ['chrome108'],
  define: { global: 'globalThis' }
};

async function main() {
  const configs = [extensionConfig, webviewConfig];
  if (watch) {
    const ctxs = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(ctxs.map((c) => c.watch()));
  } else {
    const ctxs = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(
      ctxs.map(async (c) => {
        await c.rebuild();
        await c.dispose();
      })
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
