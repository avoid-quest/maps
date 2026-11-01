const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const config = getDefaultConfig(__dirname);
// Gradle replaces these directories during native builds. Watching them can
// crash Metro with ENOENT and they contain no JavaScript source.
config.resolver.blockList = [
  ...[config.resolver.blockList ?? []].flat(),
  /[/\\]android[/\\](?:app[/\\])?(?:build|\.gradle|\.cxx)(?:[/\\]|$)/,
];
// The bundled GTT timetable ships as a file asset (read once for import), not as a JS module.
config.resolver.assetExts = [...config.resolver.assetExts, 'gttpkg'];
module.exports = withNativeWind(config, { input: './global.css' });
