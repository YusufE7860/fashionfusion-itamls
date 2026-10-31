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
        description: 'IT Asset Management, Helpdesk, Signage & RMM — install as a desktop/mobile app for faster access.',
        // 'standalone' = own window, no browser chrome. Works identically on
        // mobile (home-screen icon) and desktop (taskbar / Dock icon).
        display: 'standalone',
        // Fall back to 'minimal-ui' then 'browser' on older desktop browsers.
        display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        id: '/',
        lang: 'en-ZA',
        dir: 'ltr',
        // Categories hint helps desktop app menus (Windows Start, GNOME) group
        // the app alongside other productivity tools.
        categories: ['productivity', 'business', 'utilities'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Right-click shortcuts on the installed app's taskbar / dock icon.
        // Chrome / Edge render these as a jumplist menu.
        shortcuts: [
          { name: 'Log a ticket',    short_name: 'Log',     url: '/helpdesk/new',       description: 'Open the New Ticket form' },
          { name: 'Helpdesk queue',  short_name: 'Queue',   url: '/helpdesk',           description: 'See every open ticket' },
          { name: 'Signage players', short_name: 'Signage', url: '/signage/devices',    description: 'TV / media player status' },
          { name: 'Dashboard',       short_name: 'Home',    url: '/',                   description: 'Overview + alerts' },
        ],
        // When present, Chrome's desktop install dialog shows these as a
        // preview carousel so the user knows what they're installing.
        screenshots: [
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', form_factor: 'wide', label: 'Dashboard' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', form_factor: 'narrow', label: 'Dashboard (mobile)' },
        ],
        // Lets the user open ITAMLS as the default handler for URLs like
        // https://it.ffgsa.co.za/... when the PWA is installed on desktop.
        handle_links: 'preferred',
        launch_handler: { client_mode: 'navigate-existing' },
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
