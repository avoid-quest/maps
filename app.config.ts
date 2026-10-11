import type { ExpoConfig } from 'expo/config';
const buildRevision = process.env.AVOID_MAPS_BUILD_REVISION;
const config: ExpoConfig = {
  name: 'Avoid Maps',
  slug: 'avoid-maps',
  version: '0.1.7',
  icon: './assets/icon.png',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  extra: { diagnosticsRevision: buildRevision && /^[a-f0-9]{40}$/.test(buildRevision) ? buildRevision : 'development' },
  android: {
    package: 'quest.avoid.maps',
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#185CE5' },
    versionCode: 8,
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
