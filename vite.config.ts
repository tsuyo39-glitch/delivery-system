import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/delivery-system/',
  build: {
    rollupOptions: {
      input: resolve(__dirname, 'app.html'),
    },
  },
  plugins: [react()],
});
