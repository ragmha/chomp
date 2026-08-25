import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Two rule groups here are load-bearing rather than stylistic, and both exist
 * because a skill says so. They are the deterministic backstop behind advisory
 * policy — the playbook's point that a skill makes violations rare and a hard
 * check makes them close to impossible.
 */

/** secure-web-app rule 1 & 2: never build markup from data, never eval. */
const noMarkupFromData = [
  {
    selector:
      "MemberExpression[property.name=/^(innerHTML|outerHTML)$/]",
    message:
      'secure-web-app: writing markup from data is a DOM XSS. Use textContent or createElement.',
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: 'secure-web-app: insertAdjacentHTML is a DOM XSS. Build nodes instead.',
  },
  {
    selector: "CallExpression[callee.object.name='document'][callee.property.name='write']",
    message: 'secure-web-app: document.write is forbidden.',
  },
  {
    selector: "NewExpression[callee.name='Function']",
    message: 'secure-web-app: no dynamic code. The CSP blocks this anyway.',
  },
];

/**
 * The engine must be a pure reducer, or replay determinism breaks and the eval
 * suite loses its oracle. A leak here surfaces as a flaky test rather than a
 * design violation, which is exactly why it needs to be a lint error and not a
 * convention. See plan/0001-chomp.md risk R1.
 */
const enginePurity = [
  {
    selector: "MemberExpression[object.name='Math'][property.name='random']",
    message: 'engine must be deterministic: use the seeded PRNG in src/engine/rng.ts.',
  },
  {
    selector: "MemberExpression[object.name='Date'][property.name='now']",
    message: 'engine must be deterministic: time is measured in ticks, not milliseconds.',
  },
  {
    selector: "NewExpression[callee.name='Date']",
    message: 'engine must be deterministic: no wall-clock in the engine.',
  },
  {
    selector: "MemberExpression[object.name='performance']",
    message: 'engine must be deterministic: no wall-clock in the engine.',
  },
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'tools/**', 'playwright-report/**', 'test-results/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      'no-restricted-syntax': ['error', ...noMarkupFromData],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...noMarkupFromData, ...enginePurity],
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'engine is pure: no DOM below src/render/.' },
        { name: 'window', message: 'engine is pure: no DOM below src/render/.' },
        { name: 'localStorage', message: 'engine is pure: persistence belongs to the shell.' },
      ],
    },
  },

  {
    files: ['**/*.test.ts', 'e2e/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
