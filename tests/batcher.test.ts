import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  createBatches,
  DEFAULT_TOKEN_BUDGET,
  MAX_FILES_PER_BATCH,
} from '../src/review/batcher.js';
import type { FileDiffWithContext } from '../src/types.js';

/** Helper to create a FileDiffWithContext with a specific content size */
function makeFile(path: string, diffSize: number, contextSize: number = 0): FileDiffWithContext {
  return {
    path,
    diff: 'x'.repeat(diffSize),
    context: contextSize > 0 ? 'y'.repeat(contextSize) : null,
    additions: 10,
    deletions: 5,
    isNew: false,
    isDeleted: false,
    isBinary: false,
  };
}

describe('estimateTokens', () => {
  it('estimates tokens from diff only', () => {
    const file = makeFile('a.ts', 400);
    // 400 chars / 4 = 100 tokens
    expect(estimateTokens(file)).toBe(100);
  });

  it('estimates tokens from diff + context', () => {
    const file = makeFile('a.ts', 400, 800);
    // (400 + 800) / 4 = 300 tokens
    expect(estimateTokens(file)).toBe(300);
  });

  it('handles null context', () => {
    const file = makeFile('a.ts', 100);
    expect(estimateTokens(file)).toBe(25);
  });

  it('rounds up for non-divisible sizes', () => {
    const file = makeFile('a.ts', 5);
    // 5 / 4 = 1.25 → ceil → 2
    expect(estimateTokens(file)).toBe(2);
  });

  it('returns 0 for empty diff with no context', () => {
    const file: FileDiffWithContext = {
      path: 'empty.ts',
      diff: '',
      context: null,
      additions: 0,
      deletions: 0,
      isNew: false,
      isDeleted: false,
      isBinary: false,
    };
    expect(estimateTokens(file)).toBe(0);
  });
});

describe('createBatches', () => {
  it('returns empty array for no files', () => {
    expect(createBatches([])).toEqual([]);
  });

  it('puts a single file in one batch', () => {
    const files = [makeFile('a.ts', 100)];
    const batches = createBatches(files);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    expect(batches[0]![0]!.path).toBe('a.ts');
  });

  it('groups small files into one batch', () => {
    // Each file ~250 tokens, 5 files = 1250 tokens — well within 80K budget
    const files = Array.from({ length: 5 }, (_, i) => makeFile(`file${i}.ts`, 1000));
    const batches = createBatches(files);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(5);
  });

  it('splits files when token budget is exceeded', () => {
    // Budget = 1000 tokens. Each file = 600 tokens (2400 chars / 4)
    // Only 1 file fits per batch
    const files = [makeFile('a.ts', 2400), makeFile('b.ts', 2400), makeFile('c.ts', 2400)];
    const batches = createBatches(files, 1000);
    expect(batches).toHaveLength(3);
  });

  it('respects MAX_FILES_PER_BATCH limit', () => {
    // Create 20 tiny files — token-wise they all fit, but max 15 per batch
    const files = Array.from({ length: 20 }, (_, i) => makeFile(`file${i}.ts`, 4));
    const batches = createBatches(files);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(MAX_FILES_PER_BATCH);
    expect(batches[1]).toHaveLength(5);
  });

  it('puts oversized file in solo batch', () => {
    // One huge file (500K tokens) that exceeds budget on its own
    const huge = makeFile('huge.ts', DEFAULT_TOKEN_BUDGET * 4 * 2); // way over budget
    const small = makeFile('small.ts', 100);
    const batches = createBatches([huge, small]);
    expect(batches).toHaveLength(2);
    // Huge file should be alone in its batch
    const hugeBatch = batches.find((b) => b.some((f) => f.path === 'huge.ts'));
    expect(hugeBatch).toHaveLength(1);
  });

  it('uses FFD to pack efficiently', () => {
    // Budget = 100 tokens
    // Files: 60, 40, 40, 30 tokens
    // FFD: [60+40=100], [40+30=70] → 2 batches (not 3)
    const files = [
      makeFile('a.ts', 160), // 40 tokens
      makeFile('b.ts', 120), // 30 tokens
      makeFile('c.ts', 240), // 60 tokens
      makeFile('d.ts', 160), // 40 tokens
    ];
    const batches = createBatches(files, 100);
    expect(batches).toHaveLength(2);
  });

  it('preserves all files across batches', () => {
    const files = Array.from({ length: 10 }, (_, i) => makeFile(`file${i}.ts`, 400));
    const batches = createBatches(files, 500);
    const allPaths = batches.flat().map((f) => f.path);
    expect(allPaths).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(allPaths).toContain(`file${i}.ts`);
    }
  });
});
