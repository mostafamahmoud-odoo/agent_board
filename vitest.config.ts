import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // `vscode` is provided by the editor at runtime and is external in the
      // bundle, so a plain Node runner cannot resolve it.
      vscode: path.resolve(__dirname, 'test/stubs/vscode.ts')
    }
  },
  test: {
    // DOM-free on purpose. jsdom has no getBBox at all (the renderer throws)
    // and happy-dom returns zeros, which is worse: layout runs to completion
    // with every node at (0,0) and the snapshot passes while asserting
    // nothing. Layout takes an injected TextMeasurer instead.
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    reporters: 'default'
  }
});
