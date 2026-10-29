import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

const isElectronBuild = process.env.ELECTRON_BUILD === 'true';
const isTrialEdition = process.env.VITE_BUILD_EDITION === 'trial';

export default defineConfig({
  base: isElectronBuild ? './' : '/',
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  plugins: [
    react(),
    ...(isElectronBuild
      ? []
      : [
          VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Apex POS — نظام البيع وإدارة المخزون',
        short_name: 'Apex POS',
        description: 'إدارة المخزون والبيع بالتقسيط - يعمل بلا إنترنت',
        theme_color: '#2563eb',
        background_color: '#f5f7fa',
        display: 'standalone',
        orientation: 'any',
        lang: 'ar',
        dir: 'rtl',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          { urlPattern: /^https:\/\/fonts\./, handler: 'CacheFirst', options: { cacheName: 'fonts' } },
        ],
      },
            }),
          ]),
  ],
  resolve: {
    // Trial builds replace the supplier console with a redirect stub so none of
    // its code is bundled. Must precede the '@' alias.
    alias: [
      ...(isTrialEdition
        ? [
            {
              find: '@/features/license/AdminGeneratePage',
              replacement: path.resolve(__dirname, 'src/features/license/AdminGeneratePage.trial.tsx'),
            },
          ]
        : []),
      { find: '@', replacement: path.resolve(__dirname, 'src') },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    globals: true,
    // Tests cover the gated trial behaviour, which is the shipping default.
    env: { VITE_BUILD_EDITION: 'trial' },
  },
} as ReturnType<typeof defineConfig>);
