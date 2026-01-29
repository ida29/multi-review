import type {
  FileModelReview,
  FileMergedReview,
  MergedIssue,
  Severity,
  Consensus,
} from '../types.js';

/**
 * Merge per-file reviews from multiple models using naive merge.
 * Deduplicates issues by title, takes highest severity, tracks consensus.
 */
export function mergeFileReviews(
  filePath: string,
  reviews: readonly FileModelReview[],
  totalModels: number,
): FileMergedReview {
  const successful = reviews.filter((r) => r.status === 'success');

  if (successful.length === 0) {
    return {
      filePath,
      issues: [],
      summary: 'No models returned successful reviews for this file.',
      modelResults: reviews,
    };
  }

  if (successful.length === 1) {
    const review = successful[0]!;
    return {
      filePath,
      issues: review.issues.map((issue) => ({
        ...issue,
        file: issue.file ?? filePath,
        consensus: 'single' as const,
        models: [review.model],
      })),
      summary: review.summary,
      modelResults: reviews,
    };
  }

  // 2+ successful reviews — naive merge
  const merged = naiveMerge(successful, totalModels);

  return {
    filePath,
    issues: merged.issues,
    summary: merged.summary,
    modelResults: reviews,
  };
}

/**
 * Naive merge: deduplicate by title match, take highest severity, track models.
 */
function naiveMerge(
  reviews: readonly FileModelReview[],
  totalModels: number,
): { issues: MergedIssue[]; summary: string } {
  const issueMap = new Map<string, { issue: MergedIssue; models: string[] }>();

  for (const review of reviews) {
    for (const issue of review.issues) {
      const key = issue.title.toLowerCase().trim();
      const existing = issueMap.get(key);

      if (existing) {
        // Don't add duplicate model
        if (!existing.models.includes(review.model)) {
          existing.models.push(review.model);
        }
        const updatedModels = [...existing.models];

        // Take highest severity and longest description
        const newSeverity =
          severityRank(issue.severity) > severityRank(existing.issue.severity)
            ? issue.severity
            : existing.issue.severity;
        const newDescription =
          issue.description.length > existing.issue.description.length
            ? issue.description
            : existing.issue.description;

        issueMap.set(key, {
          issue: {
            title: existing.issue.title,
            severity: newSeverity,
            file: existing.issue.file ?? issue.file,
            line: existing.issue.line ?? issue.line,
            description: newDescription,
            suggestion: issue.suggestion ?? existing.issue.suggestion,
            consensus: determineConsensus(updatedModels.length, totalModels),
            models: updatedModels,
          },
          models: updatedModels,
        });
      } else {
        issueMap.set(key, {
          issue: {
            ...issue,
            file: issue.file,
            consensus: determineConsensus(1, totalModels),
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

function determineConsensus(modelCount: number, totalModels: number): Consensus {
  if (modelCount === totalModels) return 'unanimous';
  if (modelCount > totalModels / 2) return 'majority';
  return 'single';
}
