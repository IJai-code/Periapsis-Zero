/**
 * Lint for mistakes, not for style.
 *
 * Every rule here catches a bug that a build does not: Vite compiles an
 * undefined name happily and the page throws when the line runs. Two such
 * bugs shipped in October 2026 (a missing import in Driver.jsx that threw
 * every frame after a piloted lunar landing, another in CameraRig.jsx that
 * threw on every key press in free flight) and one more was caught only in
 * review (a hook reading a const declared below it). Formatting, naming and
 * taste are left alone on purpose.
 *
 *   npm run lint            and it runs in verify:all, so CI holds it
 */
import globals from 'globals'

const correctness = {
  'no-undef': 'error',
  // Same-scope use before a const/let is declared: a temporal-dead-zone throw.
  'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'error',
  'no-const-assign': 'error',
  'no-redeclare': 'error',
  'no-self-assign': 'error',
  'no-unsafe-negation': 'error',
  'valid-typeof': 'error',
}

/*
 * Two files carry eslint-disable comments for react-hooks/exhaustive-deps from
 * an earlier setup. The rule is not installed (it is about style, not
 * crashes), so it is registered here as a no-op rather than deleting the
 * comments that record a deliberate dependency choice.
 */
const reactHooks = { rules: { 'exhaustive-deps': { create: () => ({}) } } }

export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'art/**', '.freebuff/**'] },
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      // process: read only behind a typeof guard, so the same modules run in Node's gates.
      globals: { ...globals.browser, ...globals.worker, __APP_VERSION__: 'readonly', process: 'readonly' },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: correctness,
  },
  {
    files: ['scripts/**/*.{js,mjs}', '*.config.js', 'vite.config.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: correctness,
  },
]
