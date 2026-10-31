import { defineConfig } from 'vite';
import path from 'path';
import { readFileSync } from 'node:fs';

const steamPromoPath = path.resolve(__dirname, '../_includes/steam-promo.html');

export default defineConfig(({ command }) => ({
  root: path.resolve(__dirname),
  plugins: [{
    name: 'shared-steam-promo',
    apply: 'serve',
    // Use the same widget markup as Jekyll on every development page.
    transformIndexHtml(html) {
      return html.replace(/<body\b[^>]*>/i, body => `${body}\n${readFileSync(steamPromoPath, 'utf8')}`);
    },
    configureServer(server) {
      server.watcher.add(steamPromoPath);
      server.watcher.on('change', file => {
        if (path.resolve(file) === steamPromoPath) server.ws.send({ type: 'full-reload' });
      });
    },
  }],
  // Relative asset URLs, so emitted references (the embed-worker chunk, the
  // sql.js wasm) resolve wherever the bundle is mounted — the Jekyll site
  // serves it under baseurl /steam-tags-analyzer, where absolute '/assets/...' 404s.
  base: './',
  // Dev server: serve ../assets at / so index.html's /css/style.css resolves
  // (nothing is copied in serve mode). Build: publicDir OFF — the heavy
  // runtime artifacts (DB, models, rankers) come from the CDN (lib/config.ts),
  // and copying ../assets used to duplicate ~450MB into the build output.
  publicDir: command === 'serve' ? path.resolve(__dirname, '../assets') : false,
  server: {
    port: 3001,
    // /mnt/* (Windows drives under WSL) emits no inotify events, so without
    // polling Vite serves stale transforms until the server is restarted.
    watch: { usePolling: true, interval: 300 },
  },
  build: {
    outDir: path.resolve(__dirname, '../assets/js'),
    emptyOutDir: true,
    // Build output is NOT committed — the Pages workflow builds it from the
    // TS sources (the canonical public code), so minification is free wins.
    // Sourcemaps deploy alongside and point devtools at the commented TS.
    sourcemap: true,
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, 'lib/main.ts'),
        analytics: path.resolve(__dirname, 'lib/analytics/main.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'lib'),
    },
  },
  worker: {
    format: 'es',
  },
}));
