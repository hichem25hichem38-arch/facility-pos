import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const appVersion: string = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

const isElectronBuild = process.env.ELECTRON_BUILD === 'true';
const isCapBuild = process.env.CAP_BUILD === 'true';
const isTrialEdition = process.env.VITE_BUILD_EDITION === 'trial';

/* Older APKs registered a PWA worker that kept serving their cached bundle
   after an update. Native builds ship this stub at the same /sw.js path so the
   old worker deletes its caches, unregisters and reloads the app once. */
const NATIVE_SW_STUB = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    await Promise.all(clients.map((client) => client.navigate(client.url)));
  })());
});
`;

function nativeServiceWorkerCleanup(): Plugin {
  return {
    name: 'cap-native-sw-cleanup',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: NATIVE_SW_STUB });
    },
  };
}

export default defineConfig({
  base: isElectronBuild ? './' : '/',
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion) },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  plugins: [
    react(),
    ...(isCapBuild ? [nativeServiceWorkerCleanup()] : []),
    // A service worker inside an APK keeps serving the previous bundle after an
    // app update, so PWA caching is web-only.
    ...(isElectronBuild || isCapBuild
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
