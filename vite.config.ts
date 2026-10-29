import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Exact policy; see spec Phase 1 "Content-Security-Policy". The only network the app may reach is
// the GitHub REST API and raw.githubusercontent.com (optional "Baseline from GitHub", only from
// src/sources/github.ts). Never widen this ad hoc: update the spec first.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.github.com https://raw.githubusercontent.com",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

// Build only: the dev server injects an inline React-refresh <script> that this policy would block.
function cspMeta(): Plugin {
  return {
    name: 'tbp-csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        },
      ],
    },
  };
}

// Dev/preview servers are bound to loopback only. Never pass `--host`.
// `base: './'` keeps every asset URL relative, so `dist/` works from any sub-path (GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), cspMeta()],
  server: { host: '127.0.0.1', fs: { strict: true } },
  preview: { host: '127.0.0.1' },
  build: {
    rolldownOptions: {
      output: {
        // Separate vendor chunks so app updates do not invalidate the cached library code.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/](d3-[a-z-]+|internmap|yaml)[\\/]/ },
          ],
        },
      },
    },
  },
});
