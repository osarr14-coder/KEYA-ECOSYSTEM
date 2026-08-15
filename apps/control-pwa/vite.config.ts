import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Ticket 010 (passe 1) : la PWA doit fonctionner hors ligne dès la
    // saisie, pas seulement stocker en IndexedDB — `injectManifest` serait
    // sur-ingénieré ici (pas de logique offline custom nécessaire cette
    // passe, aucune synchronisation à intercepter) : `generateSW` (mode par
    // défaut de vite-plugin-pwa) suffit à précacher l'app shell pour un
    // chargement hors ligne, la donnée elle-même vit dans IndexedDB
    // (voir src/db), pas dans le cache HTTP du service worker.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'KEYA CONTROL',
        short_name: 'CONTROL',
        description: 'Inspections de chantier en mobilité, hors ligne (ticket 010)',
        theme_color: '#1F2937',
        background_color: '#FFFFFF',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5175,
  },
});
