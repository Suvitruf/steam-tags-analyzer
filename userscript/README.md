# Steam Tag Analyzer userscript

Tag audits and game research directly on Steam store pages. Check a game's
tags, explore its niche, compare games and browse publisher portfolios with
Tampermonkey or Violentmonkey.

[Install the userscript](https://raw.githubusercontent.com/Suvitruf/steam-tags-analyzer/master/userscript/dist/steam-tag-audit.user.js) · [Report an issue](https://github.com/Suvitruf/steam-tags-analyzer/issues)

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/get-it/).
2. Open [Install the userscript](https://raw.githubusercontent.com/Suvitruf/steam-tags-analyzer/master/userscript/dist/steam-tag-audit.user.js)
   and confirm installation in your manager. If the file opens as plain text,
   choose **Create a new script** in the manager, replace its template with
   the complete file contents and save.
3. Open or reload a Steam page. Click **Check tags** under a game's tags or
   expand a **Steam Tag Analyzer** research panel.

If your browser asks for it, enable **Allow User Scripts** for the manager.
See [Tampermonkey's permission instructions](https://www.tampermonkey.net/faq.php?q=Q209).
The interface is in English. Disable or remove the script through your manager.

## Check a game's tags

Open a Steam game page and click **Check tags**. When a saved audit is available,
it shows tag classifications, explanations, suggestions, similar games and
observation dates.

Choose **Run audit here** to calculate an audit using the current Steam page.
This also works for games without a saved audit or outside the dataset.
Released and Coming soon games need a description and tags; DLC and other app
types are unsupported.

Before calculation, the panel warns about the download: an uncached model is
about **67 MB compressed**, plus game data and runtime files. Opening the panel
alone does not download the model. Progress and cancellation are available;
closing the panel stops the calculation. Cached files are reused when browser
storage is available. The script and analyzer website have separate caches.

Use **Open full audit** to continue on the analyzer website. The script
never edits your Steam tags or reads your account or library.

## Explore games and niches

- **Niche research** — on a Steam tag page, explore release years, review
  distributions, the share of games reaching 250 or 1,000 reviews, and related
  tags. Choose release years and optionally an age-at-observation window.
- **Game context** — on a game page, compare its reviews and price with releases
  from the same year that share a chosen tag. Adjust the peer group to explore
  another niche. Review percentiles require at least 30 observed peers.
- **Compare games** — use **Add to comparison** on game pages or search results
  to select up to 12 games, then choose **Compare selected games**. Compare
  release dates, reviews, prices, publishers, tags and store features.
  Your selection is saved locally.
- **Publisher portfolio** — on a publisher page, explore its released games,
  yearly releases, reviews and common tags. Filter by niche or expand the full
  catalog. If Steam's creator-page name differs from the publisher credit,
  enter that credit manually.
- **Upcoming peers** — on a Coming soon game page, choose **Load release calendar**
  after checking the download size, then select a tag and release window.
  Undated games can be included separately. Announced dates may change, and the
  calendar covers tracked games rather than every upcoming Steam release.
- **Tag changes** — open this panel on a game page to save its current top 20 tags.
  The first check establishes a baseline; later checks show additions, removals,
  rank changes and renamed tags since your previous successful check. History
  is local to your browser and starts when you first check a game. Use
  **Forget local tag history** to clear that game's record.

Research panels load data when opened. They show observation dates, missing
values and small samples so you can judge how much evidence is available.

## Pages to try

| Feature | Example and what to do |
| --- | --- |
| Tag audit | [RimWorld](https://store.steampowered.com/app/294100/RimWorld/) — click **Check tags**, then **Run audit here** for a current-page audit |
| Niche research | [Colony Sim](https://store.steampowered.com/tags/en/Colony%20Sim/) — open **Niche research** and choose release years |
| Game context | [RimWorld](https://store.steampowered.com/app/294100/RimWorld/) — open **Game context** and choose a peer group |
| Compare games | [Colony Sim search](https://store.steampowered.com/search/?tags=220585) — add two games, then compare them |
| Publisher portfolio | [Hooded Horse](https://store.steampowered.com/publisher/HoodedHorse/) — open **Publisher portfolio** |
| Upcoming peers | [Pocket Cat Desktop](https://store.steampowered.com/app/4865920/Pocket_Cat_Desktop/) — while marked Coming soon, open **Upcoming peers** and load the calendar |
| Tag changes | Any game page — open **Tag changes** to save the first observation, then check again later |
