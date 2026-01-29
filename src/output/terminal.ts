import pc from 'picocolors';
import type { MergedReport, MergedIssue, Severity, Consensus, ModelReview } from '../types.js';

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

/**
 * Print the merged report to terminal with colors.
 */
export function printReport(report: MergedReport, verbose: boolean): void {
  console.log();
  console.log(pc.bold(pc.underline('Multi-Review Report')));
  console.log();

  // Summary
  console.log(pc.bold('Summary'));
  console.log(pc.dim('─'.repeat(60)));
  console.log(report.summary);
  console.log();

  // Issues by severity
  const criticals = report.issues.filter((i) => i.severity === 'critical');
  const warnings = report.issues.filter((i) => i.severity === 'warning');
  const suggestions = report.issues.filter((i) => i.severity === 'suggestion');
  const goods = report.issues.filter((i) => i.severity === 'good');

  if (report.issues.length === 0) {
    console.log(pc.green('No issues found. Code looks clean!'));
  } else {
    console.log(
      pc.bold(
        `Found ${report.issues.length} item(s): ` +
          [
            criticals.length > 0 ? pc.red(`${criticals.length} critical`) : null,
            warnings.length > 0 ? pc.yellow(`${warnings.length} warning`) : null,
            suggestions.length > 0 ? pc.cyan(`${suggestions.length} suggestion`) : null,
            goods.length > 0 ? pc.green(`${goods.length} good`) : null,
          ]
            .filter(Boolean)
            .join(', '),
      ),
    );
    console.log();

    // Print issues grouped by severity
    for (const group of [criticals, warnings, suggestions, goods]) {
      for (const issue of group) {
        printIssue(issue);
      }
    }
  }

  // Model performance summary
  console.log(pc.dim('─'.repeat(60)));
  console.log(pc.bold('Model Performance'));
  console.log();

  for (const result of report.modelResults) {
    printModelResult(result);
  }

  if (verbose) {
    printVerboseModelResults(report.modelResults);
  }

  console.log();
}

function printIssue(issue: MergedIssue): void {
  const severity = SEVERITY_LABELS[issue.severity];
  const consensus = CONSENSUS_LABELS[issue.consensus];
  const location = formatLocation(issue.file, issue.line);

  console.log(`${severity} ${consensus} ${pc.bold(issue.title)}`);

  if (location) {
    console.log(`  ${pc.dim('at')} ${pc.underline(location)}`);
  }

  console.log(`  ${issue.description}`);

  if (issue.suggestion) {
    console.log(`  ${pc.dim('→')} ${pc.green(issue.suggestion)}`);
  }

  console.log(`  ${pc.dim(`Models: ${issue.models.join(', ')}`)}`);
  console.log();
}

function printModelResult(result: ModelReview): void {
  const statusIcon =
    result.status === 'success'
      ? pc.green('✓')
      : result.status === 'timeout'
        ? pc.yellow('⏱')
        : pc.red('✗');

  const duration = `${(result.durationMs / 1000).toFixed(1)}s`;
  const issueCount =
    result.status === 'success' ? `${result.issues.length} issues` : (result.error ?? 'failed');

  console.log(
    `  ${statusIcon} ${pc.bold(result.model)} ${pc.dim(`(${duration})`)} — ${issueCount}`,
  );
}

function printVerboseModelResults(results: readonly ModelReview[]): void {
  console.log();
  console.log(pc.bold(pc.underline('Individual Model Results')));

  for (const result of results) {
    console.log();
    console.log(pc.bold(`── ${result.model} ──`));

    if (result.status !== 'success') {
      console.log(pc.red(`  Error: ${result.error}`));
      continue;
    }

    console.log(`  ${pc.dim('Summary:')} ${result.summary}`);

    for (const issue of result.issues) {
      const severity = SEVERITY_LABELS[issue.severity];
      console.log(`  ${severity} ${issue.title}`);
    }
  }
}

function formatLocation(file?: string, line?: number): string {
  if (!file) return '';
  return line ? `${file}:${line}` : file;
}
