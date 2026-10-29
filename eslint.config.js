import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

const NO_HTML = 'Use textContent (see spec: file-derived strings).';
const NET = 'Network only in src/sources/github.ts';

// tbs.models entries, verbatim (innerHTML, outerHTML, insertAdjacentHTML, document.write)
const BASE_RESTRICTED_PROPERTIES = [
  { property: 'innerHTML', message: NO_HTML },
  { property: 'outerHTML', message: NO_HTML },
  { property: 'insertAdjacentHTML', message: NO_HTML },
  { object: 'document', property: 'write', message: 'Not allowed.' },
];
// fetch reached through a global object; lifted only for github.ts and its test
const FETCH_PROPERTIES = [
  { object: 'window', property: 'fetch', message: NET },
  { object: 'globalThis', property: 'fetch', message: NET },
  { object: 'self', property: 'fetch', message: NET },
];
// never allowed, not even in github.ts
const BEACON_PROPERTIES = [{ object: 'navigator', property: 'sendBeacon', message: NET }];
// tbs.models selectors, verbatim
const BASE_RESTRICTED_SYNTAX = [
  {
    selector: "MemberExpression[property.name='innerHTML']",
    message: NO_HTML,
  },
  {
    selector: "MemberExpression[property.name='outerHTML']",
    message: NO_HTML,
  },
  {
    selector: "MemberExpression[property.name='insertAdjacentHTML']",
    message: NO_HTML,
  },
  {
    selector: "MemberExpression[object.name='document'][property.name=/^(write|writeln)$/]",
    message: 'Not allowed.',
  },
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: NO_HTML,
  },
];
// never allowed anywhere (github.ts passes options to fetch(url, init) and never needs these)
const NETWORK_SYNTAX = [
  {
    selector: 'NewExpression[callee.name=/^(Request|XMLHttpRequest|WebSocket|EventSource)$/]',
    message: NET,
  },
  {
    selector:
      'NewExpression[callee.property.name=/^(Request|XMLHttpRequest|WebSocket|EventSource)$/]',
    message: NET,
  },
];

export default defineConfig([
  globalIgnores(['dist', 'node_modules', '.claude']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/no-danger': 'error',
      'no-restricted-globals': ['error', { name: 'fetch', message: NET }],
      'no-restricted-properties': [
        'error',
        ...BASE_RESTRICTED_PROPERTIES,
        ...FETCH_PROPERTIES,
        ...BEACON_PROPERTIES,
      ],
      'no-restricted-syntax': ['error', ...BASE_RESTRICTED_SYNTAX, ...NETWORK_SYNTAX],
    },
  },
  {
    // Node-only tooling (spec Phase 2b "v1 parity script"), run with `npx tsx`, never bundled.
    files: ['scripts/**'],
    languageOptions: { globals: globals.node },
  },
  {
    // The only module allowed to reach the network (and its mocked test); see spec Phase 1
    // "Lint additions". no-restricted-syntax is deliberately not overridden here.
    files: ['src/sources/github.ts', 'src/sources/github.test.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': ['error', ...BASE_RESTRICTED_PROPERTIES, ...BEACON_PROPERTIES],
    },
  },
]);
