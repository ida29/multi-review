import { Command } from 'commander';
import { createSpinner } from 'nanospinner';
import pc from 'picocolors';
import { resolveConfig, resolveInputMode } from './config.js';
import { readInput } from './input/index.js';
import { reviewInParallel } from './review/index.js';
import { mergeReviews } from './merge/index.js';
import { printReport } from './output/terminal.js';
import { printJsonReport } from './output/json.js';

/**
 * Run the multi-review CLI.
 */
export async function run(argv: string[]): Promise<void> {
  const program = new Command()
    .name('multi-review')
    .description('Multi-AI parallel code review using GitHub Copilot SDK')
    .version('0.1.0')
    .argument('[file]', 'File to review')
    .option('--diff', 'Review all uncommitted changes')
    .option('--pr <number>', 'Review a pull request', parseInt)
    .option('--models <list>', 'Comma-separated model list')
    .option('--merge-model <model>', 'Model to use for merging')
    .option('--timeout <seconds>', 'Timeout per model in seconds', parseInt)
    .option('--json', 'Output as JSON')
    .option('--verbose', 'Show individual model results')
    .parse(argv);

  const opts = program.opts();
  const args = {
    file: program.args[0],
    diff: opts['diff'] as boolean | undefined,
    pr: opts['pr'] as number | undefined,
    models: opts['models'] as string | undefined,
    mergeModel: opts['mergeModel'] as string | undefined,
    timeout: opts['timeout'] as number | undefined,
    json: opts['json'] as boolean | undefined,
    verbose: opts['verbose'] as boolean | undefined,
  };

  const config = resolveConfig(args);
  const inputMode = resolveInputMode(args);

  // Step 1: Read input
  const inputSpinner = createSpinner('Reading input...').start();

  let content: string;
  try {
    content = readInput(inputMode);
    inputSpinner.success({
      text: `Input ready (${content.length} chars, mode: ${inputMode.type})`,
    });
  } catch (err) {
    inputSpinner.error({ text: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }

  // Step 2: Parallel review
  const reviewSpinner = createSpinner(
    `Reviewing with ${config.models.length} models: ${config.models.join(', ')}`,
  ).start();

  const timeoutMs = config.timeoutSeconds * 1000;

  const reviews = await reviewInParallel(
    config.models,
    content,
    timeoutMs,
    (model) => {
      reviewSpinner.update({ text: `Waiting for models... (${model} started)` });
    },
    (model, result) => {
      const icon = result.status === 'success' ? '✓' : '✗';
      reviewSpinner.update({
        text: `${icon} ${model} done (${(result.durationMs / 1000).toFixed(1)}s)`,
      });
    },
  );

  const successCount = reviews.filter((r) => r.status === 'success').length;

  if (successCount === 0) {
    reviewSpinner.error({ text: 'All models failed!' });
    for (const r of reviews) {
      console.error(pc.red(`  ✗ ${r.model}: ${r.error}`));
    }
    process.exit(1);
  }

  reviewSpinner.success({
    text: `Reviews complete: ${successCount}/${reviews.length} succeeded`,
  });

  // Step 3: Merge
  let report;

  if (successCount >= 2) {
    const mergeSpinner = createSpinner(`Merging with ${config.mergeModel}...`).start();

    report = await mergeReviews(reviews, content, config.mergeModel, timeoutMs);
    mergeSpinner.success({ text: 'Merge complete' });
  } else {
    report = await mergeReviews(reviews, content, config.mergeModel, timeoutMs);
  }

  // Step 4: Output
  if (config.jsonOutput) {
    printJsonReport(report);
  } else {
    printReport(report, config.verbose);
  }

  // Exit code based on critical issues
  const hasCritical = report.issues.some((i) => i.severity === 'critical');
  process.exit(hasCritical ? 1 : 0);
}
