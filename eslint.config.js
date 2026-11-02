import tseslint from 'typescript-eslint';

export default [
  { ignores: ['node_modules/**', '.agents/**', 'dist/**', '.taste-skill/**', 'playwright-report/**', 'test-results/**'] },
  ...tseslint.configs.recommended,
  { files: ['**/*.ts', '**/*.tsx'], rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
];
