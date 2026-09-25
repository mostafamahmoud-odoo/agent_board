import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      'no-throw-literal': 'error',
      curly: 'off'
    }
  },
  {
    // FR-021: colour is decided in exactly one place. A hex literal anywhere
    // else is how the current panel ended up with ~50 hardcoded values that
    // no theme can reach.
    files: ['src/**/*.ts'],
    ignores: ['src/webview/theme/palette.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
          message:
            'Hardcoded colour. All colour must come from src/webview/theme/palette.ts, which resolves --vscode-* tokens per theme kind (FR-021).'
        }
      ]
    }
  },
  {
    files: ['src/webview/**/*.ts'],
    rules: {
      // The webview must never reach for Node APIs; the tsconfig split already
      // prevents it at type level, this catches dynamic escapes.
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'Webview code runs in a browser context.' },
        { name: 'require', message: 'Webview code runs in a browser context.' }
      ]
    }
  }
];
