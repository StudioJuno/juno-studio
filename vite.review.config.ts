import { defineConfig } from 'vite';
export default defineConfig({ root: 'review', base: '/', publicDir: false, build: { outDir: '../server/review/public', emptyOutDir: true } });
