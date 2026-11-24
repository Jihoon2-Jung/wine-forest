import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jihoon.wineforest',
  appName: 'JH Wine Forest',
  webDir: 'dist',
  server: {
    iosScheme: 'capacitor',
  },
  ios: {
    contentInset: 'never',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
    },
  },
};

export default config;
