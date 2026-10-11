const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withLocalReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    const signing = `
        release {
            def signingPath = System.getenv('AVOID_MAPS_SIGNING_PROPERTIES')
            if (signingPath) {
                def signing = new Properties()
                file(signingPath).withInputStream { signing.load(it) }
                storeFile file(signing.getProperty('storeFile'))
                storePassword signing.getProperty('storePassword')
                keyAlias signing.getProperty('keyAlias')
                keyPassword signing.getProperty('keyPassword')
            }
        }
`;
    if (mod.modResults.contents.includes("def signingPath = System.getenv('AVOID_MAPS_SIGNING_PROPERTIES')")) return mod;
    mod.modResults.contents = mod.modResults.contents.replace(
      'signingConfigs {', 'signingConfigs {' + signing,
    ).replace(/(buildTypes[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.release');
    return mod;
  });
};
