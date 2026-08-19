import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5178 },
  build: { target: 'esnext' },   // WebGPU + WebCodecs need a modern target
});
