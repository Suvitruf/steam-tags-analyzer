import type { RecommendationInput, Tag } from '../types';

/** Exact taxonomy IDs only. No implied exclusions or text-to-fact inference. */
export function resolveTagConstraints(
  input: Pick<RecommendationInput, 'includedTagIds' | 'excludedTagIds' | 'mainTag'>,
  tags: Tag[],
): { included: Tag[]; excluded: Tag[] } {
  const byId = new Map(tags.filter(t => t.is_active === 1).map(t => [t.tag_id, t]));
  const resolve = (values: number[] | undefined): Tag[] => {
    if (values === undefined) return [];
    if (!Array.isArray(values) || values.some(id => !Number.isSafeInteger(id) || id <= 0 || id > 0xffffffff)) {
      throw new Error('Choose existing Steam tags for your requirements and exclusions.');
    }
    return [...new Set(values)].map(id => {
      const tag = byId.get(id);
      if (!tag) throw new Error(`Tag ${id} is unknown or inactive. Remove it from your tag choices.`);
      return tag;
    });
  };
  const included = resolve(input.includedTagIds), excluded = resolve(input.excludedTagIds);
  const excludedIds = new Set(excluded.map(t => t.tag_id));
  const conflict = included.find(t => excludedIds.has(t.tag_id));
  if (conflict) throw new Error(`"${conflict.name}" cannot be both present and excluded. Remove it from one list.`);
  const main = input.mainTag?.trim().toLowerCase();
  if (main && excluded.some(t => t.normalized_name === main)) {
    throw new Error('The main genre/tag is excluded. Change the main tag or remove its exclusion.');
  }
  return { included, excluded };
}
