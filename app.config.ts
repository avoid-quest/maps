import type { ExpoConfig } from 'expo/config';
const buildRevision = process.env.AVOID_MAPS_BUILD_REVISION;
const isDevelopment = process.env.AVOID_MAPS_VARIANT === 'development';
const config: ExpoConfig = {
  name: isDevelopment ? 'Avoid Maps Dev' : 'Avoid Maps',
  ...(isDevelopment ? { scheme: 'avoid-maps-dev' } : {}),
  slug: 'avoid-maps',
  version: '0.1.9-preview.1',
  icon: './assets/icon.png',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  extra: { diagnosticsRevision: buildRevision && /^[a-f0-9]{40}$/.test(buildRevision) ? buildRevision : 'development' },
  android: {
    package: isDevelopment ? 'quest.avoid.maps.dev' : 'quest.avoid.maps',
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#185CE5' },
    versionCode: 10,
    allowBackup: false,
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.VIBRATE'],
  },
  plugins: [
    ['expo-dev-client', { launchMode: 'launcher', addGeneratedScheme: false }],
    ['@maplibre/maplibre-react-native', { android: { locationEngine: 'default' } }],
    './plugins/withLocalReleaseSigning',
    './plugins/withNavigation',
  ],
  web: { bundler: 'metro', name: 'Avoid Maps' },
};
export default config;
