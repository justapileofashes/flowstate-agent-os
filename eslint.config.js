// ESLint 9 flat config. TypeScript via typescript-eslint; React hook rules for
// the renderer (the codebase already carries react-hooks/exhaustive-deps and
// no-console disable comments, so those rules are on). Type-checking itself is
// `npm run typecheck`; lint stays syntactic so it runs fast.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'build/**',
      'dev_build/**',
      'release/**',
      'coverage/**',
      'market-cache/**',
      'node_modules/**',
      // Separate project with its own package.json and tooling.
      'website/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      // Unused args/vars prefixed with _ are intentional (IPC handler signatures, mocks).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      // Parsers of external formats (HTML, ANSI) legitimately match control chars.
      'no-control-regex': 'off',
    },
  },
  {
    files: ['src/main/**', 'src/preload/**', 'src/shared/**', 'scripts/**', 'tests/**', '*.config.{js,ts,cjs,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/renderer/**'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['tests/**'],
    rules: {
      // Tests cast freely to poke at internals.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
