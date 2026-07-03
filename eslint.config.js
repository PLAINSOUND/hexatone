import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  // ── Files to ignore ───────────────────────────────────────────────────────
  {
    ignores: ['build/**', 'node_modules/**', 'osc-bridge/dist/**'],
  },

  // ── Base rules for all JS/JSX source files ────────────────────────────────
  {
    files: ['src/**/*.{js,jsx}', 'vite.config.js', 'vitest.setup.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...(globals.browser ?? {}),
        ...(globals.es2021 ?? {}),
        // Preact's h and Fragment are used as JSX pragma — not imported in every file
        h: 'readonly',
        Fragment: 'readonly',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // ── Hooks discipline ──────────────────────────────────────────────────
      // These catch the render-loop class of bug we've hit in this codebase.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ── Code quality ──────────────────────────────────────────────────────
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'warn',

    },
  },

  // ── Test files: relax console and allow test globals ──────────────────────
  {
    files: ['src/**/*.test.{js,jsx}'],
    languageOptions: {
      globals: {
        ...(globals.browser ?? {}),
        ...(globals.es2021 ?? {}),
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
];
