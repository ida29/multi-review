import type {
  FileDiffWithContext,
  FileModelReview,
  FileMergedReview,
  ReviewPerspective,
} from '../types.js';
import type { CopilotClientPool } from '../shared/copilotPool.js';
import { reviewFileWithModel } from './reviewer.js';
import { mergeFileReviews } from '../aggregate/merger.js';

/** Callback for file review progress */
export interface FileReviewCallbacks {
  onFileStart?: (filePath: string) => void;
  onFileModelComplete?: (filePath: string, model: string, review: FileModelReview) => void;
  onFileComplete?: (filePath: string, merged: FileMergedReview) => void;
}

/**
 * Review files in parallel with concurrency control.
 * For each file, all models × all perspectives review in parallel, then results are merged.
 *
 * Total API calls per file = models.length × perspectives.length
 *
 * @param files - Files to review
 * @param pool - Pre-started CopilotClient pool
 * @param models - Models to use for review
 * @param perspectives - Review perspectives to use
 * @param allChangedFiles - All changed file paths (for cross-reference in prompts)
 * @param concurrency - Max files to review simultaneously
 * @param timeoutMs - Timeout per model per file
 * @param maxRetries - Max retries per model per file (exponential backoff)
 * @param retryDelayMs - Base delay between retries in ms
 * @param callbacks - Progress callbacks
 */
export async function reviewFilesInParallel(
  files: readonly FileDiffWithContext[],
  pool: CopilotClientPool,
  models: readonly string[],
  perspectives: readonly ReviewPerspective[],
  allChangedFiles: readonly string[],
  concurrency: number,
  timeoutMs: number,
  maxRetries: number = 0,
  retryDelayMs: number = 2000,
  callbacks?: FileReviewCallbacks,
): Promise<readonly FileMergedReview[]> {
  const results: FileMergedReview[] = [];
  const totalReviewers = models.length * perspectives.length;

  // Process files with concurrency limit using a semaphore pattern
  const queue = [...files];
  const active: Promise<void>[] = [];

  const processFile = async (file: FileDiffWithContext): Promise<void> => {
    callbacks?.onFileStart?.(file.path);

    // All models × all perspectives review this file in parallel
    const modelReviews = await Promise.all(
      models.flatMap((model) =>
        perspectives.map(async (perspective) => {
          const client = pool.getClient(model);
          const review = await reviewFileWithModel(
            client,
            model,
            perspective,
            file,
            allChangedFiles,
            timeoutMs,
            maxRetries,
            retryDelayMs,
          );
          callbacks?.onFileModelComplete?.(file.path, model, review);
          return review;
        }),
      ),
    );

    // Merge all results (across models AND perspectives) for this file
    const merged = mergeFileReviews(file.path, modelReviews, totalReviewers);
    callbacks?.onFileComplete?.(file.path, merged);
    results.push(merged);
  };

  for (const file of queue) {
    const task = processFile(file);
    active.push(task);

    // When we hit the concurrency limit, wait for any one to finish
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

  return results;
}
