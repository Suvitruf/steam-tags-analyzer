import { defineConfig } from 'vite';
import path from 'path';
import { readFileSync } from 'node:fs';
import { tagIdFromPath } from './lib/tag-route.mjs';

const steamPromoPath = path.resolve(__dirname, '../_includes/steam-promo.html');
const socialLinksPath = path.resolve(__dirname, '../_includes/social-links.html');
const siteNavPath = path.resolve(__dirname, '../_includes/site-nav.html');
const navigationPath = path.resolve(__dirname, '../_data/navigation.json');
const faviconsPath = path.resolve(__dirname, '../_includes/favicons.html');
const sharedIncludePaths = [steamPromoPath, socialLinksPath, siteNavPath, navigationPath, faviconsPath];

function devFavicons(): string {
  // Vite serves assets/ at the root, while Jekyll includes the site prefix.
  return readFileSync(faviconsPath, 'utf8').replace(/\{\{\s*'(\/assets\/[^']+)'\s*\|\s*relative_url\s*\}\}/g, (_match, asset: string) => asset.slice('/assets'.length));
}

function devNavigation(): string {
  // The production Liquid template and the dev shell use the same page groups.
  const groups: Array<{ title: string; items: Array<{ title: string; path: string }> }> =
    JSON.parse(readFileSync(navigationPath, 'utf8'));
  const escape = (value: string) => value.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const menus = groups.map(group => `<details class="nav-group" name="site-navigation">
    <summary>${escape(group.title)}</summary><div class="nav-menu">${group.items.map(item =>
      `<a href="/${escape(item.path.replace(/^\/|\/$/g, ''))}.html">${escape(item.title)}</a>`
    ).join('')}</div></details>`).join('');
  return `<nav class="site-nav" aria-label="Main navigation"><a href="/">Analyzer</a><a href="/audit.html">Tag Audit</a>${menus}</nav>`;
}

export default defineConfig(({ command }) => ({
  root: path.resolve(__dirname),
  plugins: [{
    name: 'shared-site-includes',
    apply: 'serve',
    // Use the same icons, navigation, promotion and social links on every dev page.
    transformIndexHtml(html) {
      return html
        .replace('</head>', () => `${devFavicons()}\n</head>`)
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
  // sql.js wasm) resolve wherever the bundle is mounted — the Jekyll site
  // serves it under baseurl /steam-tags, where absolute '/assets/...' 404s.
  base: './',
  // Dev server: serve ../assets at / so index.html's /css/style.css resolves
  // (nothing is copied in serve mode). Build: publicDir OFF — the heavy
  // runtime artifacts (DB, models, rankers) come from the CDN (lib/config.ts),
  // and copying ../assets used to duplicate ~450MB into the build output.
  publicDir: command === 'serve' ? path.resolve(__dirname, '../assets') : false,
  server: {
    port: 3000,
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
