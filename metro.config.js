const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const config = getDefaultConfig(__dirname);
// Gradle replaces these directories during native builds. Watching them can
// crash Metro with ENOENT and they contain no JavaScript source.
config.resolver.blockList = [
  ...[config.resolver.blockList ?? []].flat(),
  /[/\\]android[/\\](?:app[/\\])?(?:build|\.gradle|\.cxx)(?:[/\\]|$)/,
];
// NativeWind compiles rem as 14 px on native by default, which made text-base 14 sp and h-12 42 dp.
// 16 keeps the 16 sp body and 48 dp targets the classes describe, as on web.
module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
