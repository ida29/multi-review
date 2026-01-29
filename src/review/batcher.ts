import type { FileDiffWithContext } from '../types.js';

/** Default token budget per batch (80K tokens — quality vs context trade-off) */
export const DEFAULT_TOKEN_BUDGET = 80_000;

/** Maximum files per batch (prevents response JSON from getting too large) */
export const MAX_FILES_PER_BATCH = 15;

/** Approximate characters per token (conservative estimate) */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate the token count for a file's diff + context.
 * Uses a simple character-based heuristic: ~4 chars per token.
 */
export function estimateTokens(file: FileDiffWithContext): number {
  const diffLen = file.diff.length;
  const contextLen = file.context?.length ?? 0;
  return Math.ceil((diffLen + contextLen) / CHARS_PER_TOKEN);
}

/**
 * Split files into batches using First-Fit-Decreasing bin packing.
 *
 * 1. Sort files by estimated token count (descending)
 * 2. For each file, place it in the first batch that has room
 * 3. If no batch has room, create a new batch
 * 4. Also respects MAX_FILES_PER_BATCH per batch
 *
 * @param files - Files to batch
 * @param maxTokens - Token budget per batch (default: 80K)
 * @returns Array of file batches
 */
export function createBatches(
  files: readonly FileDiffWithContext[],
  maxTokens: number = DEFAULT_TOKEN_BUDGET,
): FileDiffWithContext[][] {
  if (files.length === 0) return [];

  // Annotate each file with its estimated token count
  const annotated = files.map((file) => ({
    file,
    tokens: estimateTokens(file),
  }));

  // Sort descending by token count (FFD)
  annotated.sort((a, b) => b.tokens - a.tokens);

  const batches: { files: FileDiffWithContext[]; totalTokens: number }[] = [];

  for (const { file, tokens } of annotated) {
    // Files that exceed the budget on their own go into a solo batch
    let placed = false;

    for (const batch of batches) {
      if (batch.files.length < MAX_FILES_PER_BATCH && batch.totalTokens + tokens <= maxTokens) {
        batch.files.push(file);
        batch.totalTokens += tokens;
        placed = true;
        break;
      }
    }

    if (!placed) {
      batches.push({ files: [file], totalTokens: tokens });
    }
  }

  return batches.map((b) => b.files);
}
