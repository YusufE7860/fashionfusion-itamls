import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    // PWA — installs ITAMLS as a mobile/desktop app from any browser.
    // We keep the service worker minimal: network-first for API, cache-first
    // for app shell + static assets. Deliberately NO offline write queue —
    // that's a trap for a tool where "did my ticket really post?" matters.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Fashion Fusion ITAMLS',
        short_name: 'ITAMLS',
        description: 'IT Asset Management, Helpdesk, Signage & RMM',
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webp,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // API: always try the network first; fall back to cache for GETs
            // only, with a tiny TTL so stale data has a short lifespan.
            urlPattern: /\/api\/.*$/,
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'itamls-api-get',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 },
            },
          },
          {
            // Static assets (fonts, images) — cache-first
            urlPattern: /\.(?:png|jpg|jpeg|svg|webp|woff2|ico)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'itamls-static',
              expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173, host: true },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@itamls/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  optimizeDeps: {
    exclude: ['@itamls/shared'],
  },
});
