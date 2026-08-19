import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Ticket 020 : premier port libre après HOME (5173), BUILD (5174),
    // CONTROL PWA (5175).
    port: 5176,
  },
});
