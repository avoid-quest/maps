const { withSettingsGradle } = require('expo/config-plugins');

// The development launcher includes Google barcode-scanner dependencies even in release.
// Keep it installed for the Dev variant, but outside the production native graph.
module.exports = function withProductionModules(config) {
  return withSettingsGradle(config, (mod) => {
    const marker = 'expoAutolinking.useExpoModules()';
    // SDK 54 serializes multiple exclusions as one CLI argument; the launcher alone owns GMS/MLKit.
    const exclusion = "expoAutolinking.exclude = ['expo-dev-launcher']";
    if (mod.modResults.contents.includes(exclusion)) return mod;
    if (!mod.modResults.contents.includes(marker)) throw new Error('Expo autolinking settings changed; review production module exclusions.');
    mod.modResults.contents = mod.modResults.contents.replace(marker, `${exclusion}\n${marker}`);
    return mod;
  });
};
