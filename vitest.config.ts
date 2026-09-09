import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
  },
});
