import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  plugins: [preact()],
  server: { port: 5180, strictPort: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
