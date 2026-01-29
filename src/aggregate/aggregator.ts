import type {
  TriagedFile,
  FileMergedReview,
  AggregatedReport,
  WalkthroughEntry,
  ReviewStats,
  ModelPerformance,
  Severity,
} from '../types.js';

/**
 * Aggregate all results into the final report.
 * Combines triage results, file reviews, and computes stats.
 */
export function aggregate(
  triaged: readonly TriagedFile[],
  fileReviews: readonly FileMergedReview[],
  models: readonly string[],
): AggregatedReport {
  const walkthrough = buildWalkthrough(triaged, fileReviews);
  const stats = computeStats(triaged, fileReviews);
  const modelPerformance = computeModelPerformance(fileReviews, models);

  return {
    walkthrough,
    fileReviews,
    stats,
    modelPerformance,
  };
}

function buildWalkthrough(
  triaged: readonly TriagedFile[],
  fileReviews: readonly FileMergedReview[],
): WalkthroughEntry[] {
  const reviewMap = new Map(fileReviews.map((r) => [r.filePath, r]));

  return triaged.map((t) => {
    const review = reviewMap.get(t.file.path);

    let summary: string;
    if (t.decision === 'skip') {
      summary = `Skipped: ${t.reason}`;
    } else if (t.decision === 'context_only') {
      summary = `Context only: ${t.reason}`;
    } else if (review) {
      summary = review.summary || 'Reviewed (no summary)';
    } else {
      summary = 'Pending review';
    }

    return {
      filePath: t.file.path,
      summary,
      decision: t.decision,
    };
  });
}

function computeStats(
  triaged: readonly TriagedFile[],
  fileReviews: readonly FileMergedReview[],
): ReviewStats {
  const totalFiles = triaged.length;
  const reviewedFiles = triaged.filter((t) => t.decision === 'review').length;
  const skippedFiles = triaged.filter((t) => t.decision === 'skip').length;
  const contextOnlyFiles = triaged.filter((t) => t.decision === 'context_only').length;

  const allIssues = fileReviews.flatMap((r) => r.issues);
  const totalIssues = allIssues.length;

  const countBySeverity = (s: Severity) => allIssues.filter((i) => i.severity === s).length;

  return {
    totalFiles,
    reviewedFiles,
    skippedFiles,
    contextOnlyFiles,
    totalIssues,
    criticalCount: countBySeverity('critical'),
    warningCount: countBySeverity('warning'),
    suggestionCount: countBySeverity('suggestion'),
    goodCount: countBySeverity('good'),
  };
}

function computeModelPerformance(
  fileReviews: readonly FileMergedReview[],
  models: readonly string[],
): ModelPerformance[] {
  return models.map((model) => {
    const reviews = fileReviews.flatMap((fr) => fr.modelResults.filter((mr) => mr.model === model));

    const totalFiles = reviews.length;
    const successCount = reviews.filter((r) => r.status === 'success').length;
    const errorCount = reviews.filter((r) => r.status === 'error').length;
    const timeoutCount = reviews.filter((r) => r.status === 'timeout').length;
    const totalDurationMs = reviews.reduce((sum, r) => sum + r.durationMs, 0);
    const avgDurationMs = totalFiles > 0 ? Math.round(totalDurationMs / totalFiles) : 0;

    return {
      model,
      totalFiles,
      successCount,
      errorCount,
      timeoutCount,
      totalDurationMs,
      avgDurationMs,
    };
  });
}
