# Steam Tag Analyzer

[![Build and deploy Pages](https://github.com/Suvitruf/steam-tags-analyzer/actions/workflows/pages.yml/badge.svg)](https://github.com/Suvitruf/steam-tags-analyzer/actions/workflows/pages.yml)
[Website](https://steam-tags-analyzer.apanasik.com/) · [Report an issue](https://github.com/Suvitruf/steam-tags-analyzer/issues)

> Developed while working on [Pocket Cat Desktop](https://store.steampowered.com/app/4865920/Pocket_Cat_Desktop/?utm_source=github&utm_medium=web&utm_campaign=steam_tags_analyzer&utm_content=suvitruf), this tool grew out of the experimental project to analyze market and Steam.

**Choose accurate Steam tags and understand the games competing for your audience.**

Steam Tag Analyzer helps indie developers describe their game, find relevant comparison titles, and research a niche using observed Steam data. It recommends tags that fit the game and have useful commercial associations within similar games, rather than simply promoting the most popular tags.

## What you can do

- **Analyze a game pitch.** Get primary and secondary tags, misleading tags to avoid, and similar successful games that explain the recommendations.
- **Use competitor games.** Enter Steam App IDs to include their tags. Games without dataset tags are looked up on Steam; results show which competitors were included and why others could not be counted.
- **Audit an existing store page.** Inspect which tags describe the game, correspond to declared store features, or deserve further investigation.
- **Choose paid or free games.** All game analytics offer All games, Paid games and Free games, with the selection saved on your device and in shared links.
- **Build a comparison cohort.** Filter by release years, tag positions, included/excluded tags, observed price, features, and publisher-name states. Save filters on your device, share links, and export game lists as CSV.
- **Compare outcomes.** Explore review distributions, reception, concentration, and validated H3/H6/H12 review histories. Review thresholds are configurable, with **250 reviews** as the default.
- **Share tag research.** Every tag has a permanent page such as `/tags/492-indie/`, with a description and basic statistics readable without JavaScript. Charts and the configurable review threshold load in the browser.
- **Research positioning.** Inspect tag combinations, market trends, pricing, declared features, release timing, upcoming release windows, and publisher catalogs relevant to your niche.

| Area | Pages |
| --- | --- |
| Tag recommendations | Analyzer, Tag Audit |
| Comparable games | Niche Benchmarks, Compare Games, Review Lifecycle |
| Market research | Tag Explorer, Tag Combos, Trends, Trending Now, Validated Momentum, Market Map |
| Store and launch research | Features, Pricing, Release Timing, Upcoming Releases |
| Catalog context | Publisher Portfolios, Tag Changelog, Data Coverage |

## Reading the results

Reviews are public observations, **not sales, revenue, or profitability**. Reaching a review threshold is an outcome to compare, not a universal definition of success. Unknown observations remain distinct from observed zeros.

The tag audit distinguishes a tag's taxonomy status from the selected model's coverage. An active tag without a model vector can still be supported by the description, store features or similar games. When evidence is insufficient, it appears as **Not assessed**; unknown tag IDs also remain unassessed. **Retired** follows an explicitly inactive taxonomy record.

Paid/free groups use the latest observed final price: positive or zero. All games also includes unknown prices. Discounts can affect membership; zero observed price is not verified free-to-play status. Historical charts use the current price group. Data Coverage and Tag Changelog describe the entire collection and taxonomy.

Current tags, prices, features, and publisher credits can differ from their launch-time values. Comparisons show associations and expose sample sizes and coverage limits. Equal-age comparisons require validated histories and release anchors; missing months are not filled with zeros. The Data Coverage page explains the snapshot, exclusions, and metric definitions.

This project is not affiliated with Valve or Steam.

## How it runs

The application runs in the browser. The analyzer and locally calculated audits prefer an inference pack: compact game/tag data plus tables for the selected model. Transformers.js performs embedding inference in a Web Worker. The recommendation engine ranks relevant tags against comparable games.

Large runtime assets are downloaded separately:

- versioned inference packs and App-ID detail files, with the browser database as a compatibility fallback;
- embedding models, rankers, and game vectors;
- immutable analytics snapshots and their manifest.

The pack separates nightly game data from tables tied to a trained model set.
Descriptions and store fields load when a game is looked up or audited. Files
are verified against SHA-256 hashes and cached under immutable URLs; the
manifest pins one consistent snapshot per visit. sql.js loads only for the
legacy database path when the pack manifest is not yet available.

On the November 2026 snapshot, the core and gte-base tables total **8.68 MB
gzip**, replacing the **39.3 MB** browser database download. Encoder, ranker
and game-vector downloads are additional. The analyzer and audits without a
ready-made result can still download substantial data on first use. Analytics pages load smaller JSON
snapshots and selected cohorts. Data and models are needed at runtime.

The audit page first checks for a precomputed result for the selected game and
model. When available, it loads only the manifest, audit index and that result;
no model, inference core or database is downloaded. The data pipeline prepares
up to 1,000 of the most-reviewed eligible games using gte-base. A result is
accepted only if its hashes, dataset snapshot, model set and audit-rule revision
match. Its generation date and tag-observation date remain visible.

Opening `/audit` alone loads no dataset or model. Missing, incompatible or
unavailable saved results use the regular browser calculation. **Refresh from
Steam** and `?live=1` always bypass saved audits. Shared links preserve a
nondefault `model` parameter. Verified results are cached locally; repeat visits
revalidate the manifest, and a network failure can reuse the last verified
snapshot offline. Keep `AUDIT_REVISION` in `sources/lib/audit/precomputed.ts`
aligned with the publisher and bump it when audit/scoring/intent rules change.

`npm run test:analyzer` checks the pack reader, lazy details, matched-set
fingerprints, caching/offline behavior and integrity failures using small
synthetic fixtures. It also checks audit taxonomy/model coverage, independent
evidence, rendered explanations, and precomputed-audit snapshot/revision checks,
cache repair, offline reuse and fallbacks. It needs no private database or model artifacts.
`VITE_INFERENCE_MANIFEST_URL` can point a local build at another compatible
manifest; otherwise the client uses the configured CDN.

## Database snapshots

[Download monthly database snapshots from Releases](https://github.com/Suvitruf/steam-tags-analyzer/releases). Each `data-YYYY-MM` release contains the full working SQLite database, including review histories, detail observations, tag snapshots and collection state.

- `steam-tags-working.db.gz` — compressed SQLite database.
- `metadata.json` — source URL, CDN modification time and ETag, packaging time, table counts, SQLite user_version, file sizes and SHA-256 checksums.
- `SHA256SUMS` — checksums for the archive and metadata.

Download all three files into the same directory, then verify and unpack:

```sh
sha256sum --check SHA256SUMS
gunzip --keep steam-tags-working.db.gz
```

The [monthly database workflow](.github/workflows/monthly-database.yml) runs on the first day of each month at **12:17 UTC**, downloading the latest available full database from the CDN. It checks SQLite integrity and the required history tables before publishing. Collection dates vary by record; the metadata records the exact downloaded snapshot. The site's browser database remains a separate, smaller export.

## Support & community

**Join on [Discord](https://discord.gg/3aDtVmNRMY)** — chat about the project, follow progress, ask questions, share ideas, or help test.

**Support development** — you can support me on [Patreon](https://www.patreon.com/apanasik).

## License

Client source code is available under the [MIT License](LICENSE). Steam data, trademarks, model artifacts, and third-party dependencies retain their respective terms and licenses.

## Static tag pages

Paid/free aggregate views require a data snapshot containing the corresponding population exports. Older snapshots report unavailable filtered data instead of showing all-game results. Static tag pages without JavaScript show the all-game snapshot.

`npm ci` uses the pinned sharp 0.33.5 override and its npm-hosted native binaries
to avoid the older GitHub/libvips installer.

`npm run build` validates the current CDN analytics manifest and summary checksum, generates one HTML page per tag, builds the browser bundles, and checks the resulting site. No database, model files, API keys, or backend are needed at build time. `npm run dev` also supports `/tags/<id>-<name>/` routes.

The numeric ID identifies a tag; the readable name suffix is decorative. Existing `/tags/#492` links continue to work. On GitHub Pages, obsolete or mistyped suffixes use the custom 404 page to redirect by ID with JavaScript. Canonical links point directly to generated HTML; unknown IDs stay on the 404 page.

Each page includes its snapshot date, canonical URL, sharing metadata, and a sitemap entry. Static figures use 250 reviews by default; interactive charts retain the selected threshold and use the same immutable snapshot as the HTML. Publication dates are not observation dates for every game.

The Pages workflow rebuilds on pushes, manual dispatch, and daily at 13:17 UTC (GitHub may delay scheduled runs). If the source is unavailable or fails validation, deployment stops and the published site stays intact. For an offline build, set `TAG_PAGES_SOURCE` to a local directory containing `manifest.json` and its immutable `releases/<snapshot>/tags-summary.json`.
