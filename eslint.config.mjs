import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import solid from 'eslint-plugin-solid/configs/typescript'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/', 'dist/', 'release/', 'coverage/', 'docs/', 'build/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ...solid,
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      'src/main/**/*.ts',
      'src/host/**/*.ts',
      'src/preload/**/*.ts',
      'e2e/**/*.ts',
      '*.config.{ts,mjs}',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
)
