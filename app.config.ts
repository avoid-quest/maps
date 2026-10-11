import type { ExpoConfig } from 'expo/config';
const config: ExpoConfig = {
  name: 'Avoid Maps',
  slug: 'avoid-maps',
  version: '0.1.1',
  icon: './assets/icon.png',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  android: {
    package: 'quest.avoid.maps',
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#185CE5' },
    versionCode: 2,
    allowBackup: false,
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.VIBRATE'],
  },
  plugins: [
    ['@maplibre/maplibre-react-native', { android: { locationEngine: 'default' } }],
    './plugins/withLocalReleaseSigning',
  ],
  web: { bundler: 'metro', name: 'Avoid Maps' },
};
export default config;
