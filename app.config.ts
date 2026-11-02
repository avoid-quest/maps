import type { ExpoConfig } from 'expo/config';
const buildRevision = process.env.AVOID_MAPS_BUILD_REVISION;
const isDevelopment = process.env.AVOID_MAPS_VARIANT === 'development';
const config: ExpoConfig = {
  // Lowercase, as across the avoid.quest family.
  name: isDevelopment ? 'avoid maps dev' : 'avoid maps',
  ...(isDevelopment ? { scheme: 'avoid-maps-dev' } : {}),
  slug: 'avoid-maps',
  version: '0.2.0-beta.1',
  icon: './assets/brand/icon.png',
  orientation: 'portrait',
  // Android night mode follows the system; ThemeProvider applies an in-app Chiaro/Scuro override at runtime.
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  extra: { diagnosticsRevision: buildRevision && /^[a-f0-9]{40}$/.test(buildRevision) ? buildRevision : 'development' },
  android: {
    package: isDevelopment ? 'quest.avoid.maps.dev' : 'quest.avoid.maps',
    // Rendered from assets/brand/mark.svg by scripts/render-brand-assets.mjs; monochrome is the Android 13+ themed icon.
    adaptiveIcon: { foregroundImage: './assets/brand/adaptive-foreground.png', monochromeImage: './assets/brand/adaptive-monochrome.png', backgroundColor: '#000000' },
    versionCode: 12,
    allowBackup: false,
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.VIBRATE'],
  },
  plugins: [
    ...(isDevelopment ? [['expo-dev-client', { launchMode: 'launcher', addGeneratedScheme: false }] as [string, Record<string, unknown>]] : ['./plugins/withProductionModules']),
    ['@maplibre/maplibre-react-native', { android: { locationEngine: 'default' } }],
    ['expo-splash-screen', { image: './assets/brand/splash-icon.png', imageWidth: 200, resizeMode: 'contain', backgroundColor: '#000000', dark: { image: './assets/brand/splash-icon.png', backgroundColor: '#000000' } }],
    // Embedded at build time; Android gets XML font families so fontWeight selects the right file.
    ['expo-font', { android: { fonts: [
      { fontFamily: 'Geist', fontDefinitions: [
        { path: './assets/fonts/Geist-Regular.ttf', weight: 400 }, { path: './assets/fonts/Geist-Medium.ttf', weight: 500 },
        { path: './assets/fonts/Geist-SemiBold.ttf', weight: 600 }, { path: './assets/fonts/Geist-Bold.ttf', weight: 700 },
      ] },
      { fontFamily: 'GeistMono', fontDefinitions: [
        { path: './assets/fonts/GeistMono-Regular.ttf', weight: 400 }, { path: './assets/fonts/GeistMono-Medium.ttf', weight: 500 },
        { path: './assets/fonts/GeistMono-SemiBold.ttf', weight: 600 }, { path: './assets/fonts/GeistMono-Bold.ttf', weight: 700 },
      ] },
      { fontFamily: 'MonaSans', fontDefinitions: [
        { path: './assets/fonts/MonaSans-Bold.ttf', weight: 700 }, { path: './assets/fonts/MonaSans-ExtraBold.ttf', weight: 800 },
        { path: './assets/fonts/MonaSans-Black.ttf', weight: 900 },
      ] },
    ] } }],
    './plugins/withLocalReleaseSigning',
    './plugins/withNavigation',
  ],
  web: { bundler: 'metro', name: 'avoid maps', favicon: './assets/brand/favicon.png' },
};
export default config;
