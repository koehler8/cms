import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vue from '@vitejs/plugin-vue';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['tests/**/*.spec.js'],
    setupFiles: ['tests/helpers/setup.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**', 'scripts/**', 'vite-plugin.js'],
      reporter: ['text', 'html'],
    },
  },
  resolve: {
    alias: {
      '../../package.json?raw': path.resolve(__dirname, 'tests/helpers/package-json-raw.js'),
    },
  },
});
