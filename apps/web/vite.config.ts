import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@itamls/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  optimizeDeps: {
    // The shared workspace package is consumed as source; don't pre-bundle it,
    // otherwise edits won't be picked up until the .vite cache is cleared.
    exclude: ['@itamls/shared'],
  },
});
