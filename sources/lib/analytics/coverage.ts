import { getManifest, fetchAnalytics } from './snapshot';
import type { CollectionHealthFile } from './core/collection-health';
import { el, fmtInt } from './format';
import { tableTwin } from './charts';
import { sitePagePath } from '../site-path';

export function analyticsPath(page: string): string {
  return sitePagePath(page);
}

export async function coverageNotice(root: HTMLElement): Promise<void> {
  const note = el('aside', 'analytics-coverage viz-caption');
  root.before(note);
  try {
    const manifest = await getManifest();
    if (!manifest) note.textContent = 'Legacy analytics export: source coverage and snapshot consistency are unavailable. ';
    else {
      const c = manifest.coverage;
      note.textContent = `Snapshot exported ${manifest.generatedAt.slice(0, 10)}. Review records: ${fmtInt(c.observedReviews)} / ${fmtInt(c.released)} released games; ${fmtInt(c.missingReviews)} unknown. `;
      const old = c.sources.reviews.olderThan30Days;
      if (old) note.append(`${fmtInt(old)} review records are over 30 days old. `);
    }
  } catch {
    note.textContent = 'Data coverage could not be loaded. ';
  }
  const link = el('a', undefined, note);
  link.href = analyticsPath('coverage');
  link.textContent = 'Coverage and metric definitions';
}

export async function initCoverage(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  el('p', 'analytics-intro', root).textContent =
    'Analytics describe released Steam games observed by this project. Review thresholds are observed outcomes, not revenue, profitability, or the effect of changing a tag. Zero observed reviews and unavailable reviews are different states.';
  try {
    const m = await getManifest();
    if (!m) { el('p', undefined, root).textContent = 'This legacy export has no coverage manifest. Run the updated analytics export to populate this page.'; return; }
    const c = m.coverage;
    el('p', undefined, root).textContent = `Exported ${m.generatedAt.slice(0, 10)}. Export time is not the collection date of every game.`;
    tableTwin(root, ['Field', 'Games'], [
      ['Released games in catalog', c.released], ['Observed review counts', c.observedReviews],
      ['Missing review counts', c.missingReviews], ['Observed zero reviews', c.zeroReviews],
      ['At least ten reviews', c.rated], ['Stored tags', c.tagged], ['Exact release dates', c.exactDates],
      ['Usable English category metadata', c.categoriesKnown], ['Positive observed price', c.positivePrice],
      ['Positive price with verified USD currency', c.usdPrice], ['Unknown price', c.unknownPrice],
    ]);
    tableTwin(root, ['Source', 'Oldest record', 'Newest record', 'Over 30 days old', 'Missing timestamp'],
      Object.entries(c.sources).map(([name,r]) => [name === 'detailsAttempt' ? 'Details (last attempt)' : name, r.oldest ?? 'Unknown', r.newest ?? 'Unknown', r.olderThan30Days, r.missing]));
    el('p', 'viz-caption', root).textContent = 'Legacy details timestamps can record failed attempts. Tracked source clocks distinguish attempts from successful observations; missing tracked times are not backfilled from legacy rows. Category coverage does not verify that declarations are complete or current. Historical cohort comparisons apply current tags retrospectively.';
    if(c.collection)tableTwin(root,['Collection coverage','Count'],[
      ['Released games with explicit free status',c.collection.freeStatusKnown],['Released games with category IDs',c.collection.categoryIdsKnown],
      ['Released games with initial/final price and discount',c.collection.priceBreakdownKnown],
      ['Dated detail observations (all apps)',c.collection.detailObservations],['Dated tag snapshots (all apps)',c.collection.tagSnapshots],
    ]);
    if (c.histograms) {
      const h = c.histograms;
      el('p', undefined, root).textContent = `Review histories: ${fmtInt(h.games)} games; ${fmtInt(h.eligible)} eligible at ten reviews; ${fmtInt(h.pending)} awaiting a count-matched fetch. Latest stored month: ${h.latestMonth ?? 'unknown'}. Pending counts alone do not establish freshness or successful history collection.`;
      if(h.validatedMonthly!==undefined){
        tableTwin(root,['History source validation','Games'],[['Continuous monthly source',h.validatedMonthly],['Weekly source',h.weekly??0],['Incomplete source',h.incomplete??0],['Legacy/unvalidated histories',h.legacy??0]]);
        el('p','viz-caption',root).textContent=`Successful source observations: ${h.successfulObservations?.oldest??'unknown'} through ${h.successfulObservations?.newest??'unknown'}. Monthly source validation does not by itself validate the release anchor or a requested follow-up horizon; Review Lifecycle reports those exclusions separately.`;
      }
    } else el('p', undefined, root).textContent = 'No review-history tables were available in this export.';
    if(m.artifacts['collection-health.json']){
      const health=await fetchAnalytics<CollectionHealthFile>('collection-health.json'),h=health.current;
      el('h2',undefined,root).textContent='Collection progress and failures';
      el('p',undefined,root).textContent=`Upcoming catalog: ${fmtInt(h.upcoming.verified)} of ${fmtInt(h.upcoming.games)} games have a tracked successful detail observation; ${fmtInt(h.upcoming.dated)} have a release window. Undated games remain in the collection queue.`;
      tableTwin(root,['Release year','Catalog games','Tracked details','Tracked tags','Validated monthly source'],h.years.map(y=>[String(y.year??'Unknown'),y.games,y.details,y.tags,y.monthly]));
      tableTwin(root,['Source (last 24 hours)','Latest attempt status','Distinct games'],h.attempts.map(a=>[a.source,a.status,a.games]));
      tableTwin(root,['History diagnostic (reasons can overlap)','Games'],h.diagnostics.map(d=>[d.reason,d.games]));
      tableTwin(root,['Completed refresh','Released details','Released tags','Monthly histories','Upcoming details'],health.runs.map(r=>[r.recordedAt,r.totals.details,r.totals.tags,r.totals.monthly,r.totals.upcoming]));
      el('p','viz-caption',root).textContent='Up to 90 completed refresh reports are retained. Counts track successful observations, not freshness or lifecycle eligibility. Attempt rows show the latest status per game and source in the last 24 hours, not request totals. Failed attempts preserve prior successful data. Progress starts when monitoring is deployed; no historical progress is reconstructed.';
      if(!health.runs.length)el('p',undefined,root).textContent='No completed refresh reports have been recorded yet.';
    }
    for (const d of root.querySelectorAll('details')) d.open = true;
  } catch (err) { el('p', undefined, root).textContent = (err as Error).message; }
  const definitions = el('section', 'viz-section', root);
  el('h2', undefined, definitions).textContent = 'How to read the comparisons';
  for (const text of [
    'Threshold attainment: the share of games with observed review counts reaching the selected review threshold (250 by default). Comparison tables retain 50 and 1,000 as reference levels. Known zeros are included. Missing counts are excluded and reported. Equal release year does not imply equal time on sale.',
    'Reception: the existing tag average gives every rated game equal weight and uses a ten-review prior at 70% positive. It does not measure audience temperament or Steam visibility.',
    'Reception distributions in benchmarks and the new cohort views use unsmoothed per-game positive ratios, with at least ten reviews per game. Each game has equal weight.',
    'Price: the last observed final price may include a discount. Only explicitly verified USD prices enter price-level comparisons. Zero price is a proxy, not verified free-to-play status.',
    'Publisher comparison: equality of developer and publisher names is a string-match proxy. It does not identify financing, team size, or a causal publishing effect.',
    'Feature comparisons: declarations in store metadata, with unknown metadata excluded. Associations do not establish the payoff from implementing a feature.',
    'Commercial lift in the analyzer compares tag prevalence among segment top performers with prevalence in that segment. It is distinct from a review-threshold rate.',
    'History: monthly histogram reviews have a different population from lifetime summary counts. Tags overlap, so tag shares do not add to 100%.',
    'Lifecycle: H6 is the six complete calendar months after the displayed release month, excluding that partial month. Only games with a validated anchor and all six observed monthly buckets enter every plotted point. Unknown history and insufficient age are exclusions, not zero outcomes.',
  ]) el('p', undefined, definitions).textContent = text;
}
