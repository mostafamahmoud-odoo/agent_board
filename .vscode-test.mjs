import { defineConfig } from '@vscode/test-cli';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  tests: [
    {
      label: 'integration',
      files: 'out/test/integration/**/*.test.js',
      /*
       * PINNED, not 'stable'.
       *
       * Recent VS Code builds ship an agent host that retries GitHub auth on a
       * loop. On a CI runner there is no session to resolve, so the log fills
       * with "No signed-in session resolved for resource: https://api.github.com"
       * and the run never settles. Pinning also makes the suite reproducible —
       * 'stable' meant the tests changed under us whenever VS Code shipped.
       *
       * 1.85.0 is what package.json's `engines.vscode` declares as the floor,
       * so this tests the oldest VS Code we claim to support, which is the
       * version most likely to catch an API we should not be using.
       */
      version: '1.85.0',
      extensionDevelopmentPath: __dirname,
      workspaceFolder: path.join(__dirname, 'test/fixtures/sample-workspace'),
      srcDir: 'src',
      // --disable-extensions: a debug launch otherwise loads every globally
      // installed extension. --disable-gpu matters especially here: this is an
      // SVG renderer, and GPU compositing differences surface as flake.
      launchArgs: ['--disable-extensions', '--disable-gpu', '--disable-telemetry', '--disable-updates'],
      mocha: {
        ui: 'tdd',
        timeout: 20000,
        color: true
      }
    }
  ],
  coverage: {
    reporter: ['text', 'html', 'lcov'],
    output: './coverage',
    exclude: ['**/test/**', '**/node_modules/**']
  }
});
