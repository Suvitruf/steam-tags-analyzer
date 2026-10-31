import type { TagScore } from '../types';

export interface ScoringInput {
  relevance: number;
  successLift: number;
  competitorOverlap: number;
  confidence: number;
}

export function computeTagScore(input: ScoringInput): number {
  const competitorBonus = 1.0 + 0.2 * input.competitorOverlap;

  return input.relevance
    * input.successLift
    * competitorBonus
    * input.confidence;
}

export function computeCompetitorOverlap(
  tagId: number,
  competitorTags: Array<{ tag_id: number; overlap_count: number }>,
  totalCompetitors: number
): number {
  if (totalCompetitors === 0) return 0;
  const match = competitorTags.find(t => t.tag_id === tagId);
  if (!match) return 0;
  return match.overlap_count / totalCompetitors;
}

export function generateExplanation(
  tagName: string,
  segmentName: string,
  score: TagScore,
  relevance: number,
  competitorOverlap: number
): string {
  const parts: string[] = [];

  if (score.success_lift > 1.2) {
    parts.push(
      `"${tagName}" appears ${score.success_lift.toFixed(1)}x more often among top-performing games in the ${segmentName} segment`
    );
  } else if (score.success_lift < 0.8) {
    parts.push(
      `"${tagName}" is underrepresented among top performers in ${segmentName} (${score.success_lift.toFixed(1)}x lift)`
    );
  }

  if (score.top_frequency > 0.5) {
    parts.push(`used by ${(score.top_frequency * 100).toFixed(0)}% of top games`);
  }

  if (competitorOverlap > 0.5) {
    parts.push(`shared by ${(competitorOverlap * 100).toFixed(0)}% of your competitors`);
  }

  if (relevance > 0.8) {
    parts.push('high relevance to your description');
  }

  if (parts.length === 0) {
    parts.push(`${score.success_lift.toFixed(1)}x lift in ${segmentName}, confidence ${(score.confidence * 100).toFixed(0)}%`);
  }

  return parts.join('. ') + '.';
}
