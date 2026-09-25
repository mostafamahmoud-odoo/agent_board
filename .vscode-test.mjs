import { defineConfig } from '@vscode/test-cli';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  tests: [
    {
      label: 'integration',
      files: 'out/test/integration/**/*.test.js',
      version: 'stable',
      extensionDevelopmentPath: __dirname,
      workspaceFolder: path.join(__dirname, 'test/fixtures/sample-workspace'),
      srcDir: 'src',
      // --disable-extensions: a debug launch otherwise loads every globally
      // installed extension. --disable-gpu matters especially here: this is an
      // SVG renderer, and GPU compositing differences surface as flake.
      launchArgs: ['--disable-extensions', '--disable-gpu'],
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
