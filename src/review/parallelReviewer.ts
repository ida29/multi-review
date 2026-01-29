import type {
  FileDiffWithContext,
  FileModelReview,
  FileMergedReview,
  ReviewPerspective,
  BatchReviewResult,
} from '../types.js';
import type { CopilotClientPool } from '../shared/copilotPool.js';
import { reviewBatchWithModel } from './reviewer.js';
import { mergeFileReviews } from '../aggregate/merger.js';
import { createBatches, MAX_FILES_PER_BATCH } from './batcher.js';

/** Callback for batch review progress */
export interface BatchReviewCallbacks {
  /** Called when a batch starts processing */
  onBatchStart?: (
    batchIndex: number,
    fileCount: number,
    model: string,
    perspective: ReviewPerspective,
  ) => void;
  /** Called when a batch completes */
  onBatchComplete?: (
    batchIndex: number,
    model: string,
    perspective: ReviewPerspective,
    result: BatchReviewResult,
  ) => void;
  /** Called when individual file fallback starts (batch failed) */
  onFileStart?: (filePath: string) => void;
  /** Called when an individual model call starts (fallback mode) */
  onModelCallStart?: (filePath: string, model: string, perspective: ReviewPerspective) => void;
  /** Called when an individual model call completes (fallback mode) */
  onFileModelComplete?: (filePath: string, model: string, review: FileModelReview) => void;
  /** Called when a file's merged review is complete */
  onFileComplete?: (filePath: string, merged: FileMergedReview) => void;
}

/**
 * Review files using batch API calls.
 *
 * Instead of O(files x models x perspectives) API calls,
 * this batches multiple files into each call for O(batches x models x perspectives) calls.
 *
 * Flow:
 * 1. Split files into token-budget-aware batches
 * 2. For each (model, perspective) pair, review all batches
 * 3. Concurrency controls how many (batch, model, perspective) tasks run in parallel
 * 4. Failed batches fall back to individual file reviews
 * 5. Merge all results per file
 *
 * @param files - Files to review
 * @param pool - Pre-started CopilotClient pool
 * @param models - Models to use for review
 * @param perspectives - Review perspectives to use
 * @param allChangedFiles - All changed file paths (for cross-reference in prompts)
 * @param concurrency - Max concurrent batch API calls
 * @param timeoutMs - Timeout per API call
 * @param maxRetries - Max retries per file on fallback
 * @param retryDelayMs - Base retry delay in ms
 * @param tokenBudget - Max tokens per batch (default: 80K)
 * @param callbacks - Progress callbacks
 */
export async function reviewInBatches(
  files: readonly FileDiffWithContext[],
  pool: CopilotClientPool,
  models: readonly string[],
  perspectives: readonly ReviewPerspective[],
  allChangedFiles: readonly string[],
  concurrency: number,
  timeoutMs: number,
  maxRetries: number = 0,
  retryDelayMs: number = 2000,
  tokenBudget?: number,
  callbacks?: BatchReviewCallbacks,
): Promise<readonly FileMergedReview[]> {
  // Step 1: Create batches
  const batches = createBatches(files, tokenBudget);
  const totalReviewers = models.length * perspectives.length;

  // Step 2: Generate all (batch, model, perspective) tasks
  interface BatchTask {
    batchIndex: number;
    batchFiles: readonly FileDiffWithContext[];
    model: string;
    perspective: ReviewPerspective;
  }

  const tasks: BatchTask[] = [];
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    for (const model of models) {
      for (const perspective of perspectives) {
        tasks.push({
          batchIndex,
          batchFiles: batches[batchIndex]!,
          model,
          perspective,
        });
      }
    }
  }

  // Step 3: Execute tasks with concurrency control
  const allBatchResults: BatchReviewResult[] = [];

  const processBatchTask = async (task: BatchTask): Promise<void> => {
    callbacks?.onBatchStart?.(
      task.batchIndex,
      task.batchFiles.length,
      task.model,
      task.perspective,
    );

    const client = pool.getClient(task.model);
    const result = await reviewBatchWithModel(
      client,
      task.model,
      task.perspective,
      task.batchFiles,
      allChangedFiles,
      timeoutMs,
      maxRetries,
      retryDelayMs,
    );

    // Set the correct batchIndex
    const resultWithIndex: BatchReviewResult = {
      ...result,
      batchIndex: task.batchIndex,
    };

    allBatchResults.push(resultWithIndex);
    callbacks?.onBatchComplete?.(task.batchIndex, task.model, task.perspective, resultWithIndex);
  };

  // Semaphore-based concurrency
  const queue = [...tasks];
  const active: Promise<void>[] = [];

  for (const task of queue) {
    const promise = processBatchTask(task);
    active.push(promise);

    if (active.length >= concurrency) {
      await Promise.race(active);
      // Remove settled promises
      for (let i = active.length - 1; i >= 0; i--) {
        const settled = await Promise.race([active[i]!.then(() => true), Promise.resolve(false)]);
        if (settled) {
          active.splice(i, 1);
        }
      }
    }
  }

  // Wait for remaining
  await Promise.all(active);

  // Step 4: Collect all FileModelReview results per file
  const fileReviewMap = new Map<string, FileModelReview[]>();

  for (const batchResult of allBatchResults) {
    for (const fileResult of batchResult.fileResults) {
      const existing = fileReviewMap.get(fileResult.filePath) ?? [];
      existing.push(fileResult);
      fileReviewMap.set(fileResult.filePath, existing);
    }
  }

  // Step 5: Merge results per file
  const mergedResults: FileMergedReview[] = [];

  for (const file of files) {
    const reviews = fileReviewMap.get(file.path) ?? [];
    const merged = mergeFileReviews(file.path, reviews, totalReviewers);
    callbacks?.onFileComplete?.(file.path, merged);
    mergedResults.push(merged);
  }

  return mergedResults;
}

/**
 * Get batch info for progress display.
 * Returns the number of batches and total API calls.
 */
export function getBatchInfo(
  fileCount: number,
  models: readonly string[],
  perspectives: readonly ReviewPerspective[],
): { batchCount: number; totalApiCalls: number } {
  // Estimate batch count — without actual files we use the max files per batch ceiling
  const batchCount = Math.max(1, Math.ceil(fileCount / MAX_FILES_PER_BATCH));
  const totalApiCalls = batchCount * models.length * perspectives.length;
  return { batchCount, totalApiCalls };
}
