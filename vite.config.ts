import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** 本地开发预览：直接引用 src 源码，支持 HMR */
export default defineConfig({
  root: resolve(__dirname, 'dev'),
  publicDir: resolve(__dirname, 'dev/public'),
  plugins: [react()],
  resolve: {
    alias: {
      'react-i-zone': resolve(__dirname, 'src/index.ts'),
    },
  },
  server: {
    port: 5175,
    open: true,
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
    },
  },
});
