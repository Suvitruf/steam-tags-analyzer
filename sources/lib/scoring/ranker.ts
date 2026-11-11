import { fetchBytes, type ByteProgress } from '../fetch-progress';

interface LeafNode {
  v: number;
}

interface SplitNode {
  f: number;
  t: number;
  d: string;
  l: TreeNode;
  r: TreeNode;
}

type TreeNode = LeafNode | SplitNode;

export interface RankerModel {
  format: string;
  version: number;
  feature_names: string[];
  num_trees: number;
  trees: TreeNode[];
  /** Matched-set id written by model_set.py stamp; absent on pre-manifest files. */
  set_id?: string;
}

let model: RankerModel | null = null;

export async function loadRanker(url: string, onProgress?: ByteProgress): Promise<void> {
  const bytes = await fetchBytes(url, onProgress, 'ranker');
  model = JSON.parse(new TextDecoder().decode(bytes));
}

/** undefined = no ranker loaded; null = loaded but unstamped. */
export function getRankerSetId(): string | null | undefined {
  return model ? (model.set_id ?? null) : undefined;
}

export function getRanker(): RankerModel {
  if (!model) throw new Error('Ranker not loaded');
  return model;
}

function traverseTree(node: TreeNode, features: number[]): number {
  if ('v' in node) return node.v;

  const value = features[node.f];
  const goLeft = node.d === '<=' ? value <= node.t : value < node.t;
  return traverseTree(goLeft ? node.l : node.r, features);
}

export function predict(features: number[]): number {
  if (!model) throw new Error('Ranker not loaded');

  let score = 0;
  for (const tree of model.trees) {
    score += traverseTree(tree, features);
  }
  return score;
}

export function predictBatch(featureVectors: number[][]): number[] {
  return featureVectors.map(f => predict(f));
}

// Order MUST match FEATURE_COLUMNS in the offline ranker training pipeline — the
// exported model references features by index. Global popularity stats
// (tag_game_count, tag_top1_rate, tag_avg_rank) were dropped from the model to
// avoid a raw-popularity bias; we rank on relevance, within-segment lift, and
// specificity (idf).
export const FEATURE_NAMES = [
  'embed_similarity',
  'success_lift',
  'confidence',
  'tag_frequency',
  'tag_idf',
] as const;

export type FeatureName = typeof FEATURE_NAMES[number];

export interface FeatureVector {
  embed_similarity: number;
  success_lift: number;
  confidence: number;
  tag_frequency: number;
  tag_idf: number;
}

export function featureVectorToArray(fv: FeatureVector): number[] {
  return [
    fv.embed_similarity,
    fv.success_lift,
    fv.confidence,
    fv.tag_frequency,
    fv.tag_idf,
  ];
}
