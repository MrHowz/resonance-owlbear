import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    cors: { origin: ['https://www.owlbear.rodeo', 'https://www.owlbear.app'] },
  },
  build: {
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, 'index.html'),
        background: resolve(import.meta.dirname, 'background.html'),
      },
    },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', restoreMocks: true },
});
