import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built into the repository root so GitHub Pages (main / root) serves it directly.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: '..', emptyOutDir: false, assetsDir: 'assets', chunkSizeWarningLimit: 2500 },
});
