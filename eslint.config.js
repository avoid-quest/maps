const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  {
    ignores: [
      'android/**', 'ios/**', 'dist/**', 'artifacts/**', '.expo/**',
      'public/vendor/**', 'src/data/**', 'docs/research/**', '.local/**',
      'modules/*/android/build/**', 'modules/*/android/.gradle/**',
    ],
  },
  expoConfig,
  {
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
]);
