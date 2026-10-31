// Literal intent only: this does not alter embeddings or prohibit retrieved tags.
const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'and', 'to', 'in', 'on', 'for']);

// Bound negation to a clause. Contrast/positive feature markers resume evidence;
// conjunctions stay inside the exclusion so "no combat or multiplayer" is safe.
// This deliberately handles common explicit exclusions, not general language inference.
export function normalizeIntentDescription(description: string): string {
  const text = description.toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/\bnot only\b/g, ' ');
  return text.split(/[.!?;\n]|\b(?:but|however|yet|with|featuring|only)\b/)
    .map(clause => normalizeText(clause.replace(
      /^.*\b(?:no|not|without|never|lacks?|neither|isn't|aren't|doesn't|don't|won't|can't|cannot)\b.*$/, ''
    )))
    .filter(Boolean).join(' | ');
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\bco[ -]?op\b/g, 'coop').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Two tokens "match" if identical, or if they share a long-enough common
// prefix to be morphological variants of one word: "deckbuilding" ↔
// "deckbuilder", "roguelite" ↔ "roguelike", "tactical" ↔ "tactics". The
// common prefix must be ≥ max(5, min_len − 2) chars, so short words ("dark",
// "card") only match exactly and "cat" can never claim "catapult".
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  const need = Math.max(5, minLen - 2);
  if (minLen < need) return false;
  let i = 0;
  while (i < minLen && a[i] === b[i]) i++;
  return i >= need;
}

// Fraction of a tag's meaningful words the user explicitly used (1.0 if the
// whole tag phrase appears verbatim). The phrase check is word-boundary
// anchored: "war" must appear as its own word, not inside "dwarf"/"software",
// or junk tags get force-included with a guaranteed relevance floor.
// Stem-level hits (tokensMatch) count 0.9 so "roguelite with deckbuilding"
// still credits "Roguelike Deckbuilder", slightly below an exact wording.
export function intentScore(tagName: string, descNorm: string, descTokens: Set<string>): number {
  const tagNorm = normalizeText(tagName);
  if (!tagNorm) return 0;
  if (` ${descNorm} `.includes(` ${tagNorm} `)) return 1.0;
  const tokens = tagNorm.split(' ').filter(t => t && !STOP_WORDS.has(t));
  if (tokens.length === 0) return 0;
  let score = 0;
  for (const t of tokens) {
    if (descTokens.has(t)) score += 1;
    else {
      for (const d of descTokens) {
        if (tokensMatch(t, d)) { score += 0.9; break; }
      }
    }
  }
  return score / tokens.length;
}

// A tag counts as "stated by the user" when (almost) all its words were used.
export const INTENT_STATED = 0.85;

// Boost only the MOST SPECIFIC stated tag: if the user wrote "dark fantasy",
// the "Dark" and "Fantasy" tags are subsumed by "Dark Fantasy" and get no
// boost; "Turn-Based" yields to "Turn-Based Tactics"; "Deckbuilding" yields to
// "Roguelike Deckbuilder". Without this, every generic unigram the user typed
// gets the full boost and floats above the compound identity tags.
// Partially-matched tags (intent < INTENT_STATED) get NO boost either: a
// half-matched compound tag is dangerous exactly when the unmatched half
// contradicts the description ("Action Roguelike" for a turn-based game via
// "roguelite" alone). Measured: dropping partial boosts also improves
// ground-truth id_recall/ndcg (eval/intent_specificity_fix.md).
// Returns the effective intent per candidate index (0 for subsumed/partial).
export function suppressSubsumedIntents(
  cands: Array<{ tagName: string; intent: number }>
): number[] {
  const tokenSets = cands.map(c =>
    normalizeText(c.tagName).split(' ').filter(t => t && !STOP_WORDS.has(t))
  );
  return cands.map((c, i) => {
    if (c.intent < INTENT_STATED) return 0;
    const mine = tokenSets[i];
    for (let j = 0; j < cands.length; j++) {
      if (j === i || cands[j].intent < INTENT_STATED) continue;
      const theirs = tokenSets[j];
      if (theirs.length <= mine.length) continue;
      const covered = mine.every(t => theirs.some(u => tokensMatch(t, u)));
      if (covered) return 0;
    }
    return c.intent;
  });
}
