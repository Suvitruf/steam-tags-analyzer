// Analytics pages entry point. Included site-wide by the Jekyll layout, so it
// dispatches on which container exists and no-ops elsewhere — it never loads
// the analyzer's SQLite DB or models; everything comes from the small
// precomputed JSONs and selected release-year shards on the CDN.
import { initTagExplorer } from './tag-explorer';
import { initTrends } from './trends';
import { initTiming } from './timing';
import { initTrending } from './trending';
import { initChangelog } from './changelog';
import { initInsights } from './insights';
import { coverageNotice, initCoverage } from './coverage';
import { initBenchmarks } from './benchmarks';
import { initCompare } from './compare';
import { initLifecycle } from './lifecycle';
import { initUpcoming } from './upcoming';
import { initMomentum } from './momentum';
import { initPublishers } from './publishers';
import { mountReviewThreshold } from './review-threshold';

function init(): void {
  const thresholdRoot=document.querySelector<HTMLElement>('#tag-explorer,#benchmark-explorer,#trend-explorer,#timing-explorer,#features-explorer,#prices-explorer,#combo-explorer,#market-map,#lifecycle-explorer');
  if(thresholdRoot&&!mountReviewThreshold(thresholdRoot))return;
  const publishers=document.querySelector<HTMLElement>('#publishers-explorer');if(publishers)void initPublishers(publishers);
  const upcoming=document.querySelector<HTMLElement>('#upcoming-explorer');if(upcoming)void initUpcoming(upcoming);
  const momentum=document.querySelector<HTMLElement>('#momentum-explorer');if(momentum)void initMomentum(momentum);
  const lifecycle = document.querySelector<HTMLElement>('#lifecycle-explorer');
  if (lifecycle) void initLifecycle(lifecycle);
  const benchmarks = document.querySelector<HTMLElement>('#benchmark-explorer');
  if (benchmarks) void initBenchmarks(benchmarks);
  const compare = document.querySelector<HTMLElement>('#compare-explorer');
  if (compare) void initCompare(compare);
  const coverage = document.querySelector<HTMLElement>('#coverage-explorer');
  if (coverage) void initCoverage(coverage);
  for (const node of document.querySelectorAll<HTMLElement>('[id$="-explorer"], #market-map')) {
    if (node.id !== 'coverage-explorer') void coverageNotice(node);
  }
  const explorer = document.querySelector<HTMLElement>('#tag-explorer');
  if (explorer) void initTagExplorer(explorer);

  const map = document.querySelector<HTMLElement>('#market-map');
  if (map) void initInsights(map,'map');

  const combos = document.querySelector<HTMLElement>('#combo-explorer');
  if (combos) void initInsights(combos,'combos');

  const trends = document.querySelector<HTMLElement>('#trend-explorer');
  if (trends) void initTrends(trends);

  const timing = document.querySelector<HTMLElement>('#timing-explorer');
  if (timing) void initTiming(timing);

  const trending = document.querySelector<HTMLElement>('#trending-explorer');
  if (trending) void initTrending(trending);

  const features = document.querySelector<HTMLElement>('#features-explorer');
  if (features) void initInsights(features,'features');

  const changelog = document.querySelector<HTMLElement>('#changelog-explorer');
  if (changelog) void initChangelog(changelog);

  const prices = document.querySelector<HTMLElement>('#prices-explorer');
  if (prices) void initInsights(prices,'prices');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
