import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.store.pos',
  appName: 'POS',
  webDir: 'dist',
  server: {
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  }
};

export default config;
