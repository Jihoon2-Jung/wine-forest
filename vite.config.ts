/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const envBuildTarget = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.BUILD_TARGET;
  const isCapacitorBuild = mode === 'capacitor' || envBuildTarget === 'capacitor';

  return {
    base: isCapacitorBuild ? './' : '/wine-forest/',
    resolve: {
      alias: {
        '@': new URL('./src', import.meta.url).pathname,
      },
    },
    plugins: [
      react(),
      ...(isCapacitorBuild
        ? [
            {
              name: 'strip-web-gis-script-for-capacitor',
              transformIndexHtml(html: string) {
                return html.replace(
                  /\s*<script[^>]*accounts\.google\.com\/gsi\/client[^>]*><\/script>\s*/gi,
                  '\n',
                );
              },
            },
          ]
        : [
            VitePWA({
              registerType: 'autoUpdate',
              includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'],
              manifest: {
                name: 'JH Wine Forest',
                short_name: 'Wine Forest',
                description: '개인용 와인 셀러 재고·배치·소비 이력 관리 앱',
                theme_color: '#1B4332',
                background_color: '#0D1411',
                display: 'standalone',
                start_url: '/wine-forest/',
                scope: '/wine-forest/',
                lang: 'ko',
                icons: [
                  {
                    src: 'icons/icon-192.png',
                    sizes: '192x192',
                    type: 'image/png',
                  },
                  {
                    src: 'icons/icon-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any maskable',
                  },
                ],
              },
              workbox: {
                globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
                runtimeCaching: [
                  {
                    urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard.*/i,
                    handler: 'CacheFirst',
                    options: {
                      cacheName: 'pretendard-font-cache',
                      expiration: {
                        maxEntries: 20,
                        maxAgeSeconds: 60 * 60 * 24 * 365,
                      },
                      cacheableResponse: {
                        statuses: [0, 200],
                      },
                    },
                  },
                ],
              },
            }),
          ]),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom', 'zustand', 'zod', 'idb'],
            charts: ['recharts'],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./tests/setup.ts'],
    },
  };
});
