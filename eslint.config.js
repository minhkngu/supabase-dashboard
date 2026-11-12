import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['node_modules/**', '.agents/**', 'dist/**', '.taste-skill/**', 'playwright-report/**', 'test-results/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Empty catch blocks are intentional (e.g. unavailable localStorage); other empty blocks are not.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
