import { defineConfig } from 'vite';
import path from 'path';
import { readFileSync } from 'node:fs';

const steamPromoPath = path.resolve(__dirname, '../_includes/steam-promo.html');
const githubLinkPath = path.resolve(__dirname, '../_includes/github-link.html');
const sharedIncludePaths = [steamPromoPath, githubLinkPath];

export default defineConfig(({ command }) => ({
  root: path.resolve(__dirname),
  plugins: [{
    name: 'shared-site-includes',
    apply: 'serve',
    // Use the same promotion and repository link as Jekyll on every dev page.
    transformIndexHtml(html) {
      return html
        .replace(/<body\b[^>]*>/i, body => `${body}\n${readFileSync(steamPromoPath, 'utf8')}`)
        .replace('<nav class="site-nav">', nav => `${readFileSync(githubLinkPath, 'utf8')}\n${nav}`);
    },
    configureServer(server) {
      server.watcher.add(sharedIncludePaths);
      server.watcher.on('change', file => {
        if (sharedIncludePaths.includes(path.resolve(file))) server.ws.send({ type: 'full-reload' });
      });
    },
  }],
  // Relative asset URLs, so emitted references (the embed-worker chunk, the
  // sql.js wasm) resolve both at the custom domain root and under a Jekyll
  // baseurl when the site is mounted at a subpath.
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
