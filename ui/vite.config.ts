import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': '/src' },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://mdr002pxgj.execute-api.us-east-1.amazonaws.com/prod/api',
        changeOrigin: true,
      },
    },
  },
});
