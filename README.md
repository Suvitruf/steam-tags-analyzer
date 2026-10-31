# Steam Tag Analyzer

[![Build and deploy Pages](https://github.com/Suvitruf/steam-tags-analyzer/actions/workflows/pages.yml/badge.svg)](https://github.com/Suvitruf/steam-tags-analyzer/actions/workflows/pages.yml)
[Website](https://suvitruf.github.io/steam-tags-analyzer/) · [Report an issue](https://github.com/Suvitruf/steam-tags-analyzer/issues)

> Developed while working on [Pocket Cat Desktop](https://store.steampowered.com/app/4865920/Pocket_Cat_Desktop/?utm_source=github&utm_medium=web&utm_campaign=steam_tags_analyzer&utm_content=suvitruf), this tool grew out of the experimental project to analyze market and Steam.

**Choose accurate Steam tags and understand the games competing for your audience.**

Steam Tag Analyzer helps indie developers describe their game, find relevant comparison titles, and research a niche using observed Steam data. It recommends tags that fit the game and have useful commercial associations within similar games, rather than simply promoting the most popular tags.

## What you can do

- **Analyze a game pitch.** Get primary and secondary tags, misleading tags to avoid, and similar successful games that explain the recommendations.
- **Audit an existing store page.** Inspect which tags describe the game, correspond to declared store features, or deserve further investigation.
- **Build a comparison cohort.** Filter by release years, tag positions, included/excluded tags, observed price, features, and publisher-name states. Save filters on your device, share links, and export game lists as CSV.
- **Compare outcomes.** Explore review distributions, reception, concentration, and validated H3/H6/H12 review histories. Review thresholds are configurable, with **250 reviews** as the default.
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

Current tags, prices, features, and publisher credits can differ from their launch-time values. Comparisons show associations and expose sample sizes and coverage limits. Equal-age comparisons require validated histories and release anchors; missing months are not filled with zeros. The Data Coverage page explains the snapshot, exclusions, and metric definitions.

This project is not affiliated with Valve or Steam.

## How it runs

The application runs in the browser. It reads the browser SQLite database, and Transformers.js performs embedding inference in a Web Worker. The recommendation engine ranks relevant tags against comparable games.

Large runtime assets are downloaded separately:

- browser database;
- embedding models, rankers, and game vectors;
- immutable analytics snapshots and their manifest.

The analyzer and audit can download substantial data on first use. Analytics pages load smaller JSON snapshots and selected cohorts. Data and models are needed at runtime.

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
