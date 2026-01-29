import pc from 'picocolors';
import type {
  AggregatedReport,
  FileMergedReview,
  MergedIssue,
  WalkthroughEntry,
  ModelPerformance,
  Severity,
  Consensus,
  TriageDecision,
} from '../types.js';

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: pc.bgRed(pc.white(pc.bold(' CRIT '))),
  warning: pc.bgYellow(pc.black(pc.bold(' WARN '))),
  suggestion: pc.bgCyan(pc.black(pc.bold(' SUGG '))),
  good: pc.bgGreen(pc.black(pc.bold(' GOOD '))),
};

const CONSENSUS_LABELS: Record<Consensus, string> = {
  unanimous: pc.green('[ALL AGREE]'),
  majority: pc.yellow('[MAJORITY]'),
  single: pc.dim('[1 MODEL]'),
};

const TRIAGE_ICONS: Record<TriageDecision, string> = {
  review: pc.green('R'),
  skip: pc.dim('S'),
  context_only: pc.yellow('C'),
};

/**
 * Print the aggregated report to terminal with colors.
 */
export function printAggregatedReport(report: AggregatedReport, verbose: boolean): void {
  console.log();
  console.log(pc.bold(pc.underline('Multi-Review Report (v2 Pipeline)')));
  console.log();

  // Walkthrough
  printWalkthrough(report.walkthrough);

  // Stats summary
  printStats(report);

  // Per-file issues
  if (report.fileReviews.length > 0) {
    printFileReviews(report.fileReviews);
  }

  // Model performance
  printModelPerformance(report.modelPerformance);

  // Failed reviews detail (always shown when there are failures)
  printFailedReviews(report.fileReviews);

  // Verbose: individual model results
  if (verbose) {
    printVerboseFileResults(report.fileReviews);
  }

  console.log();
}

function printWalkthrough(walkthrough: readonly WalkthroughEntry[]): void {
  console.log(pc.bold('Walkthrough'));
  console.log(pc.dim('─'.repeat(70)));

  for (const entry of walkthrough) {
    const icon = TRIAGE_ICONS[entry.decision];
    const path = entry.decision === 'skip' ? pc.dim(entry.filePath) : entry.filePath;
    const summary = entry.decision === 'skip' ? pc.dim(entry.summary) : entry.summary;

    console.log(`  ${icon} ${path}`);
    console.log(`    ${summary}`);
  }

  console.log();
}

function printStats(report: AggregatedReport): void {
  const s = report.stats;
  console.log(pc.bold('Statistics'));
  console.log(pc.dim('─'.repeat(70)));
  console.log(
    `  Files: ${s.totalFiles} total, ${pc.green(`${s.reviewedFiles} reviewed`)}, ` +
      `${pc.dim(`${s.skippedFiles} skipped`)}, ${pc.yellow(`${s.contextOnlyFiles} context`)}`,
  );

  if (s.totalIssues === 0) {
    console.log(`  ${pc.green('No issues found. Code looks clean!')}`);
  } else {
    const parts = [
      s.criticalCount > 0 ? pc.red(`${s.criticalCount} critical`) : null,
      s.warningCount > 0 ? pc.yellow(`${s.warningCount} warning`) : null,
      s.suggestionCount > 0 ? pc.cyan(`${s.suggestionCount} suggestion`) : null,
      s.goodCount > 0 ? pc.green(`${s.goodCount} good`) : null,
    ]
      .filter(Boolean)
      .join(', ');
    console.log(`  Issues: ${s.totalIssues} total — ${parts}`);
  }

  console.log();
}

function printFileReviews(reviews: readonly FileMergedReview[]): void {
  const reviewsWithIssues = reviews.filter((r) => r.issues.length > 0);

  if (reviewsWithIssues.length === 0) return;

  console.log(pc.bold('Issues by File'));
  console.log(pc.dim('─'.repeat(70)));

  for (const review of reviewsWithIssues) {
    console.log();
    console.log(pc.bold(pc.underline(review.filePath)));

    for (const issue of review.issues) {
      printIssue(issue);
    }
  }

  console.log();
}

function printIssue(issue: MergedIssue): void {
  const severity = SEVERITY_LABELS[issue.severity];
  const consensus = CONSENSUS_LABELS[issue.consensus];
  const location = formatLocation(issue.file, issue.line);

  console.log(`  ${severity} ${consensus} ${pc.bold(issue.title)}`);

  if (location) {
    console.log(`    ${pc.dim('at')} ${pc.underline(location)}`);
  }

  console.log(`    ${issue.description}`);

  if (issue.suggestion) {
    console.log(`    ${pc.dim('->')} ${pc.green(issue.suggestion)}`);
  }

  console.log(`    ${pc.dim(`Models: ${issue.models.join(', ')}`)}`);
}

function printModelPerformance(performance: readonly ModelPerformance[]): void {
  console.log(pc.dim('─'.repeat(70)));
  console.log(pc.bold('Model Performance'));
  console.log();

  for (const mp of performance) {
    const statusIcon =
      mp.errorCount === 0 && mp.timeoutCount === 0
        ? pc.green('OK')
        : mp.successCount > 0
          ? pc.yellow('!!')
          : pc.red('XX');

    const avgSec = (mp.avgDurationMs / 1000).toFixed(1);
    const totalSec = (mp.totalDurationMs / 1000).toFixed(1);

    console.log(
      `  ${statusIcon} ${pc.bold(mp.model)} — ` +
        `${mp.successCount}/${mp.totalFiles} files, ` +
        `avg ${avgSec}s, total ${totalSec}s` +
        (mp.errorCount > 0 ? pc.red(` (${mp.errorCount} errors)`) : '') +
        (mp.timeoutCount > 0 ? pc.yellow(` (${mp.timeoutCount} timeouts)`) : ''),
    );
  }
}

function printFailedReviews(reviews: readonly FileMergedReview[]): void {
  const failures: {
    filePath: string;
    model: string;
    status: string;
    error: string;
    retries: number;
  }[] = [];

  for (const review of reviews) {
    for (const result of review.modelResults) {
      if (result.status !== 'success') {
        failures.push({
          filePath: result.filePath,
          model: result.model,
          status: result.status,
          error: result.error ?? 'unknown error',
          retries: result.retries ?? 0,
        });
      }
    }
  }

  if (failures.length === 0) return;

  console.log();
  console.log(pc.bold(pc.red('Failed Reviews')));
  console.log(pc.dim('─'.repeat(70)));

  for (const f of failures) {
    const icon = f.status === 'timeout' ? pc.yellow('TM') : pc.red('XX');
    const retryInfo = f.retries > 0 ? pc.dim(` (${f.retries} retries)`) : '';
    console.log(`  ${icon} ${pc.bold(f.model)} ${pc.dim('→')} ${f.filePath}${retryInfo}`);
    console.log(`    ${pc.red(f.error)}`);
  }

  console.log();
}

function printVerboseFileResults(reviews: readonly FileMergedReview[]): void {
  console.log();
  console.log(pc.bold(pc.underline('Verbose: Per-File Model Results')));

  for (const review of reviews) {
    console.log();
    console.log(pc.bold(`-- ${review.filePath} --`));

    for (const result of review.modelResults) {
      const statusIcon =
        result.status === 'success'
          ? pc.green('OK')
          : result.status === 'timeout'
            ? pc.yellow('TM')
            : pc.red('XX');

      const duration = `${(result.durationMs / 1000).toFixed(1)}s`;
      const issueCount =
        result.status === 'success' ? `${result.issues.length} issues` : (result.error ?? 'failed');

      console.log(
        `  ${statusIcon} ${pc.bold(result.model)} ${pc.dim(`(${duration})`)} — ${issueCount}`,
      );

      if (result.status === 'success') {
        for (const issue of result.issues) {
          const severity = SEVERITY_LABELS[issue.severity];
          console.log(`    ${severity} ${issue.title}`);
        }
      }
    }
  }
}

function formatLocation(file?: string, line?: number): string {
  if (!file) return '';
  return line ? `${file}:${line}` : file;
}
