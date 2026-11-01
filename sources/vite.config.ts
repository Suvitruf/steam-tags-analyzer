import { defineConfig } from 'vite';
import path from 'path';
import { readFileSync } from 'node:fs';
import { tagIdFromPath } from './lib/tag-route.mjs';

const steamPromoPath = path.resolve(__dirname, '../_includes/steam-promo.html');
const socialLinksPath = path.resolve(__dirname, '../_includes/social-links.html');
const siteNavPath = path.resolve(__dirname, '../_includes/site-nav.html');
const sharedIncludePaths = [steamPromoPath, socialLinksPath, siteNavPath];

function devNavigation(): string {
  // Jekyll and Vite share the page list; only the development URLs differ.
  return readFileSync(siteNavPath, 'utf8').replace(/\{\{\s*'([^']+)'\s*\|\s*relative_url\s*\}\}/g, (_match, route: string) => {
    const page = route.replace(/^\/|\/$/g, '');
    return page === 'analyzer' ? '/' : `/${page}.html`;
  });
}

export default defineConfig(({ command }) => ({
  root: path.resolve(__dirname),
  plugins: [{
    name: 'shared-site-includes',
    apply: 'serve',
    // Use the same navigation, promotion and social links on every dev page.
    transformIndexHtml(html) {
      return html
        .replace(/<body\b[^>]*>/i, body => `${body}\n${readFileSync(steamPromoPath, 'utf8')}`)
        .replace(/<nav\b[^>]*class="site-nav"[^>]*>[\s\S]*?<\/nav>/, () => `${readFileSync(socialLinksPath, 'utf8')}\n${devNavigation()}`);
    },
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (tagIdFromPath(url.pathname) !== null) req.url = `/tags.html${url.search}`;
        next();
      });
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
        'tag-redirect': path.resolve(__dirname, 'lib/tag-redirect.ts'),
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
