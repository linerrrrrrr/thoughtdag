import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // External reference checkouts, the video project, and generated files have separate tooling.
  globalIgnores(['dist', 'video', 'docs/.vitepress/cache', 'local-data/references/']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    files: ['src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'JSXOpeningElement[name.name=/^[a-z]/] > JSXAttribute[name.name="title"]',
        message: 'Native title popups are not application UI. Use an independent accessible name and, only for a necessary short hint, data-tooltip.',
      }],
    },
  },
])
