import { CopilotClient } from '@github/copilot-sdk';
import type { MergedIssue, MergedReport, ModelReview, Severity } from '../types.js';
import { mergedReportOutputSchema } from './schemas.js';
import { buildMergeSystemPrompt, buildMergeMessage } from '../review/prompt.js';

/**
 * Merge multiple model reviews into a single coherent report.
 * - 0 successful reviews → empty report
 * - 1 successful review → format directly (no merge needed)
 * - 2+ successful reviews → AI merge with naive fallback
 */
export async function mergeReviews(
  reviews: readonly ModelReview[],
  originalDiff: string,
  mergeModel: string,
  timeoutMs: number,
): Promise<MergedReport> {
  const successful = reviews.filter((r) => r.status === 'success');

  if (successful.length === 0) {
    return {
      issues: [],
      summary: 'No models returned successful reviews.',
      modelResults: reviews,
    };
  }

  if (successful.length === 1) {
    const review = successful[0]!;
    return {
      issues: review.issues.map((issue) => ({
        ...issue,
        consensus: 'single' as const,
        models: [review.model],
      })),
      summary: review.summary,
      modelResults: reviews,
    };
  }

  // 2+ successful reviews — try AI merge
  try {
    const merged = await aiMerge(successful, originalDiff, mergeModel, timeoutMs);
    return { ...merged, modelResults: reviews };
  } catch {
    // Fallback to naive merge
    const merged = naiveMerge(successful);
    return { ...merged, modelResults: reviews };
  }
}

/**
 * AI-powered merge using the merge model.
 */
async function aiMerge(
  reviews: readonly ModelReview[],
  originalDiff: string,
  mergeModel: string,
  timeoutMs: number,
): Promise<Omit<MergedReport, 'modelResults'>> {
  const client = new CopilotClient();

  try {
    const session = await client.createSession({
      model: mergeModel,
      systemMessage: { mode: 'replace' as const, content: buildMergeSystemPrompt() },
    });

    const reviewInputs = reviews.map((r) => ({
      model: r.model,
      review: JSON.stringify({ issues: r.issues, summary: r.summary }, null, 2),
    }));

    const responsePromise = session.sendAndWait({
      prompt: buildMergeMessage(reviewInputs, originalDiff),
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Merge timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    const response = await Promise.race([responsePromise, timeoutPromise]);

    if (!response?.data?.content) {
      throw new Error('Empty merge response');
    }

    const rawText = response.data.content;
    const parsed = extractAndParseJson(rawText);

    if (!parsed) {
      throw new Error('Failed to parse merge JSON');
    }

    const validated = mergedReportOutputSchema.safeParse(parsed);

    if (!validated.success) {
      throw new Error(`Merge schema validation failed: ${validated.error.message}`);
    }

    await session.destroy();

    return {
      issues: validated.data.issues,
      summary: validated.data.summary,
    };
  } finally {
    await client.stop();
  }
}

/**
 * Naive merge fallback: deduplicate by exact title match,
 * take highest severity, track which models found each issue.
 */
function naiveMerge(reviews: readonly ModelReview[]): Omit<MergedReport, 'modelResults'> {
  const issueMap = new Map<
    string,
    {
      issue: MergedIssue;
      models: string[];
    }
  >();

  for (const review of reviews) {
    for (const issue of review.issues) {
      const key = issue.title.toLowerCase().trim();
      const existing = issueMap.get(key);

      if (existing) {
        existing.models.push(review.model);
        // Take highest severity
        if (severityRank(issue.severity) > severityRank(existing.issue.severity)) {
          issueMap.set(key, {
            issue: {
              ...existing.issue,
              severity: issue.severity,
              description:
                issue.description.length > existing.issue.description.length
                  ? issue.description
                  : existing.issue.description,
              suggestion: issue.suggestion ?? existing.issue.suggestion,
              consensus: determineConsensus(existing.models.length + 1, reviews.length),
              models: [...existing.models, review.model],
            },
            models: [...existing.models, review.model],
          });
        } else {
          issueMap.set(key, {
            issue: {
              ...existing.issue,
              consensus: determineConsensus(existing.models.length + 1, reviews.length),
              models: [...existing.models, review.model],
            },
            models: [...existing.models, review.model],
          });
        }
      } else {
        issueMap.set(key, {
          issue: {
            ...issue,
            consensus: 'single',
            models: [review.model],
          },
          models: [review.model],
        });
      }
    }
  }

  const issues = Array.from(issueMap.values())
    .map((entry) => entry.issue)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  const summaries = reviews.map((r) => r.summary).filter(Boolean);

  return {
    issues,
    summary: summaries.join(' | '),
  };
}

function severityRank(severity: Severity): number {
  const ranks: Record<Severity, number> = {
    good: 0,
    suggestion: 1,
    warning: 2,
    critical: 3,
  };
  return ranks[severity];
}

function determineConsensus(
  modelCount: number,
  totalModels: number,
): 'unanimous' | 'majority' | 'single' {
  if (modelCount === totalModels) return 'unanimous';
  if (modelCount > totalModels / 2) return 'majority';
  return 'single';
}

function extractAndParseJson(text: string): unknown {
  try {
    return JSON.parse(text.trim());
  } catch {
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch?.[1]) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        // Fall through
      }
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // Fall through
      }
    }

    return null;
  }
}
