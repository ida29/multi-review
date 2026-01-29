import { Command } from 'commander';
import { createSpinner } from 'nanospinner';
import pc from 'picocolors';
import { resolveConfig, resolveInputMode } from './config.js';
import { readInput } from './input/index.js';
import { parseDiff } from './parse/diffParser.js';
import { loadFileContext } from './parse/contextLoader.js';
import { triageFiles, triageFilesRulesOnly } from './triage/triager.js';
import { reviewFilesInParallel } from './review/parallelReviewer.js';
import { aggregate } from './aggregate/aggregator.js';
import { CopilotClientPool } from './shared/copilotPool.js';
import { printAggregatedReport } from './output/terminal.js';
import { printJsonReport } from './output/json.js';
import { PERSPECTIVE_LABELS } from './review/perspectives.js';
import type { FileDiffWithContext, TriagedFile } from './types.js';
import { ALL_PERSPECTIVES } from './types.js';

/**
 * Run the multi-review CLI (v2 pipeline).
 *
 * Pipeline: raw diff → Parse → Triage → Per-File Review (model × perspective) → Aggregate → Output
 */
export async function run(argv: string[]): Promise<void> {
  const program = new Command()
    .name('multi-review')
    .description('Multi-AI multi-perspective parallel code review using GitHub Copilot SDK')
    .version('0.3.0')
    .argument('[file]', 'File to review')
    .option('--diff', 'Review all uncommitted changes')
    .option('--pr <number>', 'Review a pull request', parseInt)
    .option('--stdin', 'Read from stdin (for piping)')
    .option('--models <list>', 'Comma-separated model list')
    .option('--merge-model <model>', 'Model to use for triage')
    .option('--timeout <seconds>', 'Timeout per model in seconds (default: 600)', parseInt)
    .option('--retries <n>', 'Max retries per model per file (default: 2)', parseInt)
    .option(
      '--retry-delay <ms>',
      'Base retry delay in ms, doubles each retry (default: 2000)',
      parseInt,
    )
    .option('--concurrency <n>', 'Max files to review simultaneously', parseInt)
    .option('--context-lines <n>', 'Max context lines per file', parseInt)
    .option(
      '--perspectives <list>',
      `Comma-separated review perspectives (available: ${ALL_PERSPECTIVES.join(', ')})`,
    )
    .option('--no-triage', 'Skip AI triage, review all files')
    .option('--json', 'Output as JSON')
    .option('--verbose', 'Show individual model results')
    .parse(argv);

  const opts = program.opts();
  const args = {
    file: program.args[0],
    diff: opts['diff'] as boolean | undefined,
    pr: opts['pr'] as number | undefined,
    stdin: opts['stdin'] as boolean | undefined,
    models: opts['models'] as string | undefined,
    mergeModel: opts['mergeModel'] as string | undefined,
    timeout: opts['timeout'] as number | undefined,
    retries: opts['retries'] as number | undefined,
    retryDelay: opts['retryDelay'] as number | undefined,
    concurrency: opts['concurrency'] as number | undefined,
    contextLines: opts['contextLines'] as number | undefined,
    perspectives: opts['perspectives'] as string | undefined,
    noTriage: opts['triage'] === false, // --no-triage sets opts.triage to false
    json: opts['json'] as boolean | undefined,
    verbose: opts['verbose'] as boolean | undefined,
  };

  const config = resolveConfig(args);
  const inputMode = resolveInputMode(args);

  // Show active perspectives
  const perspectiveNames = config.perspectives.map((p) => PERSPECTIVE_LABELS[p]);
  console.log(
    pc.dim(`  Perspectives: ${perspectiveNames.join(', ')} (${config.perspectives.length})`),
  );
  console.log(
    pc.dim(
      `  Reviewers per file: ${config.models.length} models × ${config.perspectives.length} perspectives = ${config.models.length * config.perspectives.length}`,
    ),
  );

  // ─── Stage 1: Read & Parse ────────────────────────────────

  const inputSpinner = createSpinner('Detecting changes...').start();

  let content: string;
  try {
    const input = readInput(inputMode);
    content = input.content;
    inputSpinner.success({
      text: `Input ready (${content.length} chars, source: ${input.resolvedMode})`,
    });
  } catch (err) {
    inputSpinner.error({ text: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }

  const parseSpinner = createSpinner('Parsing diff...').start();
  const fileDiffs = parseDiff(content);

  if (fileDiffs.length === 0) {
    parseSpinner.error({ text: 'No file changes found in diff' });
    process.exit(1);
  }

  // Load file context from working tree
  const filesWithContext: FileDiffWithContext[] = fileDiffs.map((f) => ({
    ...f,
    context: loadFileContext(f, config.contextLines),
  }));

  parseSpinner.success({
    text: `Parsed ${fileDiffs.length} file(s)`,
  });

  // ─── Stage 2: Triage ──────────────────────────────────────

  const triageSpinner = createSpinner('Triaging files...').start();

  let triaged: readonly TriagedFile[];

  if (config.noTriage) {
    // Rules only, no AI
    triaged = triageFilesRulesOnly(filesWithContext);
    triageSpinner.success({ text: 'Triage complete (rules only)' });
  } else {
    // Start a CopilotClient for AI triage (uses first model)
    const pool = new CopilotClientPool([config.mergeModel]);
    try {
      await pool.start();
      const client = pool.getClient(config.mergeModel);
      triaged = await triageFiles(
        filesWithContext,
        client,
        config.mergeModel,
        config.timeoutSeconds * 1000,
      );
    } finally {
      await pool.stop();
    }
    triageSpinner.success({ text: 'Triage complete (rules + AI)' });
  }

  const filesToReview = triaged.filter((t) => t.decision === 'review').map((t) => t.file);
  const skippedCount = triaged.filter((t) => t.decision === 'skip').length;

  if (config.verbose) {
    for (const t of triaged) {
      const icon =
        t.decision === 'review'
          ? pc.green('R')
          : t.decision === 'skip'
            ? pc.dim('S')
            : pc.yellow('C');
      const reason = pc.dim(`(${t.reason})`);
      console.log(`  ${icon} ${t.file.path} ${reason}`);
    }
    console.log();
  }

  if (filesToReview.length === 0) {
    console.log(pc.green(`All ${skippedCount} file(s) skipped. Nothing to review.`));
    process.exit(0);
  }

  console.log(pc.dim(`  ${filesToReview.length} to review, ${skippedCount} skipped`));

  // ─── Stage 3: Per-File Review ─────────────────────────────

  const allChangedFiles = triaged.map((t) => t.file.path);
  const reviewPool = new CopilotClientPool(config.models);

  const totalApiCalls = filesToReview.length * config.models.length * config.perspectives.length;

  const fileStatus = new Map<string, string>();
  for (const f of filesToReview) {
    fileStatus.set(f.path, '...');
  }
  const formatStatus = () =>
    `${[...fileStatus.values()].filter((v) => v === '...').length} pending`;

  const reviewSpinner = createSpinner(
    `Reviewing ${filesToReview.length} file(s) × ${config.perspectives.length} perspectives × ${config.models.length} models (${totalApiCalls} API calls): ${formatStatus()}`,
  ).start();

  const timeoutMs = config.timeoutSeconds * 1000;

  try {
    await reviewPool.start();

    const fileReviews = await reviewFilesInParallel(
      filesToReview,
      reviewPool,
      config.models,
      config.perspectives,
      allChangedFiles,
      config.concurrency,
      timeoutMs,
      config.maxRetries,
      config.retryDelayMs,
      {
        onFileStart: (filePath) => {
          fileStatus.set(filePath, 'reviewing');
          reviewSpinner.update({
            text: `Reviewing: ${formatStatus()}, ${filePath}...`,
          });
        },
        onFileComplete: (filePath, merged) => {
          const issueCount = merged.issues.length;
          fileStatus.set(filePath, `done(${issueCount})`);
          reviewSpinner.update({
            text: `Reviewing: ${formatStatus()}`,
          });
        },
      },
    );

    reviewSpinner.success({
      text: `Reviews complete: ${filesToReview.length} file(s), ${totalApiCalls} API calls`,
    });

    // ─── Stage 4: Aggregate ─────────────────────────────────

    const report = aggregate(triaged, fileReviews, config.models);

    // ─── Output ─────────────────────────────────────────────

    if (config.jsonOutput) {
      printJsonReport(report);
    } else {
      printAggregatedReport(report, config.verbose);
    }

    // Exit code based on critical issues
    const hasCritical = report.stats.criticalCount > 0;
    process.exit(hasCritical ? 1 : 0);
  } finally {
    await reviewPool.stop();
  }
}
