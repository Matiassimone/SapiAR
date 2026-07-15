// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')
const eslintConfigPrettier = require('eslint-config-prettier')

module.exports = defineConfig([
  expoConfig,
  eslintConfigPrettier,
  {
    ignores: ['dist/**', '.expo/**', 'ios/**', 'android/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'import/no-default-export': 'error',
    },
  },
  {
    // Expo Router requires default exports for screens under app/.
    files: ['app/**/*.{ts,tsx}', 'App.tsx'],
    rules: {
      'import/no-default-export': 'off',
    },
  },
])
