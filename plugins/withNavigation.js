const { withAppBuildGradle, withProjectBuildGradle, withSettingsGradle, withGradleProperties } = require('expo/config-plugins');

// Ferrostar 0.57 requires API 25, desugaring, and Kotlin 2.3 library metadata support.
// Kotlin 2.2.20/KSP 2.2.20-2.0.3 and R8 8.13.19 are the verified consumer toolchain.
module.exports = function withNavigation(config) {
  config = withGradleProperties(config, (mod) => {
    for (const [key, value] of [['android.kotlinVersion', '2.2.20'], ['android.minSdkVersion', '25']]) {
      mod.modResults = mod.modResults.filter((entry) => entry.key !== key);
      mod.modResults.push({ type: 'property', key, value });
    }
    return mod;
  });
  config = withProjectBuildGradle(config, (mod) => {
    mod.modResults.contents = mod.modResults.contents.replace(
      "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')",
      "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.20')",
    );
    return mod;
  });
  config = withSettingsGradle(config, (mod) => {
    if (!mod.modResults.contents.includes('com.android.tools:r8:8.13.19')) {
      mod.modResults.contents = mod.modResults.contents.replace('pluginManagement {', `pluginManagement {
  buildscript {
    repositories { google(); mavenCentral() }
    dependencies { classpath("com.android.tools:r8:8.13.19") }
  }`);
    }
    return mod;
  });
  return withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes('// Avoid Maps navigation toolchain')) {
      mod.modResults.contents += `
// Avoid Maps navigation toolchain
android {
    compileOptions { coreLibraryDesugaringEnabled true }
    packagingOptions { resources { excludes += 'META-INF/versions/9/OSGI-INF/MANIFEST.MF' } }
}
dependencies { coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.1.5' }
`;
    }
    return mod;
  });
};
