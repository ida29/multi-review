import { Command } from 'commander';
import { createSpinner } from 'nanospinner';
import pc from 'picocolors';
import { resolveConfig, resolveInputMode } from './config.js';
import { readInput } from './input/index.js';
import { parseDiff } from './parse/diffParser.js';
import { loadFileContext } from './parse/contextLoader.js';
import { triageFiles, triageFilesRulesOnly } from './triage/triager.js';
import { reviewInBatches } from './review/parallelReviewer.js';
import { createBatches } from './review/batcher.js';
import { aggregate } from './aggregate/aggregator.js';
import { CopilotClientPool } from './shared/copilotPool.js';
import { printAggregatedReport } from './output/terminal.js';
import { printJsonReport } from './output/json.js';
import { PERSPECTIVE_LABELS } from './review/perspectives.js';
import type { FileDiffWithContext, TriagedFile, BatchReviewResult } from './types.js';
import { ALL_PERSPECTIVES } from './types.js';

/**
 * Run the multi-review CLI (v0.4 pipeline — batch review).
 *
 * Pipeline: raw diff → Parse → Triage → Batch Review (model × perspective) → Aggregate → Output
 */
export async function run(argv: string[]): Promise<void> {
  const program = new Command()
    .name('multi-review')
    .description('Multi-AI multi-perspective parallel code review using GitHub Copilot SDK')
    .version('0.4.0')
    .argument('[file]', 'File to review')
    .option('--diff', 'Review all uncommitted changes')
    .option('--pr <number>', 'Review a pull request', parseInt)
    .option('--stdin', 'Read from stdin (for piping)')
    .option('--models <list>', 'Comma-separated model list')
    .option('--merge-model <model>', 'Model to use for triage')
    .option('--timeout <seconds>', 'Timeout per model in seconds (default: 120)', parseInt)
    .option('--retries <n>', 'Max retries per model per file (default: 0)', parseInt)
    .option(
      '--retry-delay <ms>',
      'Base retry delay in ms, doubles each retry (default: 2000)',
      parseInt,
    )
    .option('--concurrency <n>', 'Max batch API calls simultaneously', parseInt)
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
      `  Reviewers: ${config.models.length} models × ${config.perspectives.length} perspectives = ${config.models.length * config.perspectives.length} per batch`,
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

  // ─── Stage 3: Batch Review ─────────────────────────────────

  const allChangedFiles = triaged.map((t) => t.file.path);
  const reviewPool = new CopilotClientPool(config.models);

  // Compute batch info for progress display
  const batches = createBatches(filesToReview);
  const batchCount = batches.length;
  const totalApiCalls = batchCount * config.models.length * config.perspectives.length;

  console.log(
    pc.dim(
      `  Batched: ${filesToReview.length} files → ${batchCount} batch(es) × ${config.models.length} models × ${config.perspectives.length} perspectives = ${totalApiCalls} API calls`,
    ),
  );

  if (totalApiCalls > 100) {
    console.log(
      pc.yellow(
        `  ⚠ ${totalApiCalls} API calls planned. Use --perspectives, --models, or --no-triage to reduce.`,
      ),
    );
  }

  let completedBatches = 0;
  let successBatches = 0;
  let partialBatches = 0;
  let fallbackBatches = 0;
  const activeCalls = new Set<string>();
  const reviewStartTime = Date.now();

  const formatElapsed = () => {
    const sec = Math.floor((Date.now() - reviewStartTime) / 1000);
    return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
  };

  const formatProgress = () => {
    const parts = [`${completedBatches}/${totalApiCalls} calls`];
    if (partialBatches > 0) parts.push(pc.yellow(`${partialBatches} partial`));
    if (fallbackBatches > 0) parts.push(pc.red(`${fallbackBatches} fallback`));

    const activeList = [...activeCalls].slice(0, 3).join(', ');
    const moreCount = activeCalls.size > 3 ? ` +${activeCalls.size - 3}` : '';

    return `Reviewing [${formatElapsed()}] ${parts.join(', ')}${activeList ? ` | ${activeList}${moreCount}` : ''}`;
  };

  const reviewSpinner = createSpinner(
    `Batch reviewing ${filesToReview.length} file(s) in ${batchCount} batch(es) (${totalApiCalls} API calls)`,
  ).start();

  // Update spinner every second to show elapsed time
  const progressTimer = setInterval(() => {
    reviewSpinner.update({ text: formatProgress() });
  }, 1000);

  const timeoutMs = config.timeoutSeconds * 1000;

  try {
    await reviewPool.start();

    const fileReviews = await reviewInBatches(
      filesToReview,
      reviewPool,
      config.models,
      config.perspectives,
      allChangedFiles,
      config.concurrency,
      timeoutMs,
      config.maxRetries,
      config.retryDelayMs,
      undefined, // use default token budget
      {
        onBatchStart: (
          batchIndex: number,
          fileCount: number,
          model: string,
          perspective: string,
        ) => {
          const label = `B${batchIndex + 1}:${model}/${perspective}(${fileCount}f)`;
          activeCalls.add(label);
          reviewSpinner.update({ text: formatProgress() });
        },
        onBatchComplete: (
          batchIndex: number,
          model: string,
          perspective: string,
          result: BatchReviewResult,
        ) => {
          const label = `B${batchIndex + 1}:${model}/${perspective}(${result.fileResults.length}f)`;
          activeCalls.delete(label);
          completedBatches++;
          if (result.status === 'success') successBatches++;
          if (result.status === 'partial') partialBatches++;
          if (result.status === 'fallback') fallbackBatches++;
          reviewSpinner.update({ text: formatProgress() });
        },
      },
    );

    clearInterval(progressTimer);

    const totalDuration = formatElapsed();
    const resultParts = [
      `${filesToReview.length} file(s)`,
      `${completedBatches} API calls`,
      totalDuration,
    ];
    if (successBatches > 0) resultParts.push(pc.green(`${successBatches} ok`));
    if (partialBatches > 0) resultParts.push(pc.yellow(`${partialBatches} partial`));
    if (fallbackBatches > 0) resultParts.push(pc.red(`${fallbackBatches} fallback`));

    reviewSpinner.success({
      text: `Reviews complete: ${resultParts.join(', ')}`,
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
    clearInterval(progressTimer);
    await reviewPool.stop();
  }
}
