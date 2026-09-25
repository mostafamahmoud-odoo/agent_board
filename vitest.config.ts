import { defineConfig } from 'vitest/config';

export default defineConfig({
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
