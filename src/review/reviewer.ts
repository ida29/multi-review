import type { CopilotClient } from '@github/copilot-sdk';
import type {
  FileModelReview,
  ReviewIssue,
  FileDiffWithContext,
  ReviewPerspective,
  BatchReviewResult,
} from '../types.js';
import { modelReviewOutputSchema, batchReviewOutputSchema } from '../aggregate/schemas.js';
import { extractAndParseJson } from '../shared/jsonParser.js';
import {
  buildSystemPrompt,
  buildPerFileReviewMessage,
  buildBatchSystemPrompt,
  buildBatchReviewMessage,
} from './prompt.js';

/** Sleep for a given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Check if a failed result is worth retrying */
function isRetryable(result: FileModelReview): boolean {
  if (result.status === 'success') return false;

  // Timeout is always retryable
  if (result.status === 'timeout') return true;

  // Parse/schema errors are NOT retryable (model will give same garbage)
  if (result.error?.includes('Failed to parse JSON')) return false;
  if (result.error?.includes('Schema validation failed')) return false;
  if (result.error === 'Empty response from model') return false;

  // Quota/rate limit exceeded — NOT retryable (won't recover in seconds)
  if (result.error?.includes('Quota exceeded')) return false;
  if (result.error?.includes('rate limit')) return false;

  // Everything else (network errors, 5xx) — retry
  return true;
}

/**
 * Review a single file with a single model from a specific perspective.
 * Retries transient errors (timeout, network, 5xx, rate limit) with exponential backoff.
 * Non-retryable errors (parse/schema) fail immediately.
 */
export async function reviewFileWithModel(
  client: CopilotClient,
  model: string,
  perspective: ReviewPerspective,
  file: FileDiffWithContext,
  allChangedFiles: readonly string[],
  timeoutMs: number,
  maxRetries: number = 0,
  retryDelayMs: number = 2000,
): Promise<FileModelReview> {
  const totalStart = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Exponential backoff before retry (skip delay on first attempt)
    if (attempt > 0) {
      const delay = retryDelayMs * 2 ** (attempt - 1);
      await sleep(delay);
    }

    const result = await attemptReview(
      client,
      model,
      perspective,
      file,
      allChangedFiles,
      timeoutMs,
    );

    // Success or non-retryable error — return immediately
    if (result.status === 'success' || !isRetryable(result)) {
      return { ...result, durationMs: Date.now() - totalStart, retries: attempt };
    }

    // Last attempt — return the failure
    if (attempt === maxRetries) {
      return { ...result, durationMs: Date.now() - totalStart, retries: attempt };
    }
  }

  // Should not reach here, but TypeScript needs it
  return {
    model,
    filePath: file.path,
    perspective,
    status: 'error',
    issues: [],
    summary: '',
    durationMs: Date.now() - totalStart,
    error: 'Unexpected: retry loop exited without result',
    retries: maxRetries,
  };
}

/**
 * Single attempt to review a file with a model from a specific perspective (no retry).
 */
async function attemptReview(
  client: CopilotClient,
  model: string,
  perspective: ReviewPerspective,
  file: FileDiffWithContext,
  allChangedFiles: readonly string[],
  timeoutMs: number,
): Promise<FileModelReview> {
  const start = Date.now();

  try {
    const session = await client.createSession({
      model,
      systemMessage: { mode: 'replace' as const, content: buildSystemPrompt(perspective) },
    });

    const message = buildPerFileReviewMessage(file.path, file.diff, file.context, allChangedFiles);

    const response = await session.sendAndWait({ prompt: message }, timeoutMs);
    const durationMs = Date.now() - start;

    if (!response?.data?.content) {
      return {
        model,
        filePath: file.path,
        perspective,
        status: 'error',
        issues: [],
        summary: '',
        durationMs,
        error: 'Empty response from model',
      };
    }

    const rawText = response.data.content;
    const parsed = extractAndParseJson(rawText);

    if (!parsed) {
      return {
        model,
        filePath: file.path,
        perspective,
        status: 'error',
        issues: [],
        summary: '',
        durationMs,
        error: `Failed to parse JSON from response: ${rawText.slice(0, 200)}...`,
      };
    }

    const validated = modelReviewOutputSchema.safeParse(parsed);

    if (!validated.success) {
      return {
        model,
        filePath: file.path,
        perspective,
        status: 'error',
        issues: [],
        summary: '',
        durationMs,
        error: `Schema validation failed: ${validated.error.message}`,
      };
    }

    const issues: ReviewIssue[] = validated.data.issues.map((issue) => ({
      title: issue.title,
      severity: issue.severity,
      file: issue.file ?? file.path,
      line: issue.line,
      description: issue.description,
      suggestion: issue.suggestion,
    }));

    await session.destroy();

    return {
      model,
      filePath: file.path,
      perspective,
      status: 'success',
      issues,
      summary: validated.data.summary,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const isTimeout = err instanceof Error && err.message.includes('Timeout');

    return {
      model,
      filePath: file.path,
      perspective,
      status: isTimeout ? 'timeout' : 'error',
      issues: [],
      summary: '',
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Batch Review ────────────────────────────────────────────

/**
 * Review a batch of files with a single model from a specific perspective.
 * Sends all files in one API call using the batch prompt format.
 *
 * On failure, falls back to individual per-file reviews.
 *
 * @returns BatchReviewResult with status 'success', 'partial' (some files missing), or 'fallback'
 */
export async function reviewBatchWithModel(
  client: CopilotClient,
  model: string,
  perspective: ReviewPerspective,
  files: readonly FileDiffWithContext[],
  allChangedFiles: readonly string[],
  timeoutMs: number,
  maxRetries: number = 0,
  retryDelayMs: number = 2000,
): Promise<BatchReviewResult> {
  const start = Date.now();

  const batchResult = await attemptBatchReview(
    client,
    model,
    perspective,
    files,
    allChangedFiles,
    timeoutMs,
  );

  if (batchResult) {
    const durationMs = Date.now() - start;

    // Check if all files got results
    const resultPaths = new Set(batchResult.map((r) => r.filePath));
    const missingFiles = files.filter((f) => !resultPaths.has(f.path));

    if (missingFiles.length === 0) {
      // All files accounted for
      return {
        model,
        perspective,
        batchIndex: 0, // Caller sets this
        fileResults: batchResult,
        status: 'success',
        durationMs,
      };
    }

    // Some files missing — fill in with individual fallback
    const fallbackResults = await fallbackToIndividual(
      client,
      model,
      perspective,
      missingFiles,
      allChangedFiles,
      timeoutMs,
      maxRetries,
      retryDelayMs,
    );

    return {
      model,
      perspective,
      batchIndex: 0,
      fileResults: [...batchResult, ...fallbackResults],
      status: 'partial',
      durationMs: Date.now() - start,
    };
  }

  // Batch failed entirely — fallback to individual file reviews
  const fallbackResults = await fallbackToIndividual(
    client,
    model,
    perspective,
    files,
    allChangedFiles,
    timeoutMs,
    maxRetries,
    retryDelayMs,
  );

  return {
    model,
    perspective,
    batchIndex: 0,
    fileResults: fallbackResults,
    status: 'fallback',
    durationMs: Date.now() - start,
  };
}

/**
 * Attempt a batch review. Returns FileModelReview[] on success, null on failure.
 */
async function attemptBatchReview(
  client: CopilotClient,
  model: string,
  perspective: ReviewPerspective,
  files: readonly FileDiffWithContext[],
  allChangedFiles: readonly string[],
  timeoutMs: number,
): Promise<FileModelReview[] | null> {
  try {
    const session = await client.createSession({
      model,
      systemMessage: {
        mode: 'replace' as const,
        content: buildBatchSystemPrompt(perspective),
      },
    });

    const message = buildBatchReviewMessage(files, allChangedFiles);
    const response = await session.sendAndWait({ prompt: message }, timeoutMs);

    await session.destroy();

    if (!response?.data?.content) {
      return null;
    }

    const rawText = response.data.content;
    const parsed = extractAndParseJson(rawText);

    if (!parsed) {
      return null;
    }

    const validated = batchReviewOutputSchema.safeParse(parsed);

    if (!validated.success) {
      return null;
    }

    // Convert batch response into per-file FileModelReview results
    return validated.data.fileReviews.map((fileReview) => {
      const issues: ReviewIssue[] = fileReview.issues.map((issue) => ({
        title: issue.title,
        severity: issue.severity,
        file: issue.file ?? fileReview.filePath,
        line: issue.line,
        description: issue.description,
        suggestion: issue.suggestion,
      }));

      return {
        model,
        filePath: fileReview.filePath,
        perspective,
        status: 'success' as const,
        issues,
        summary: fileReview.summary,
        durationMs: 0, // Batch timing is at the batch level
      };
    });
  } catch {
    return null;
  }
}

/**
 * Fallback: review files individually when batch fails.
 */
async function fallbackToIndividual(
  client: CopilotClient,
  model: string,
  perspective: ReviewPerspective,
  files: readonly FileDiffWithContext[],
  allChangedFiles: readonly string[],
  timeoutMs: number,
  maxRetries: number,
  retryDelayMs: number,
): Promise<FileModelReview[]> {
  const results: FileModelReview[] = [];
  for (const file of files) {
    const result = await reviewFileWithModel(
      client,
      model,
      perspective,
      file,
      allChangedFiles,
      timeoutMs,
      maxRetries,
      retryDelayMs,
    );
    results.push(result);
  }
  return results;
}
