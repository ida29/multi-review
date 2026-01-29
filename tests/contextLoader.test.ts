import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadFileContext } from '../src/parse/contextLoader.js';
import type { FileDiff } from '../src/types.js';

const TMP_DIR = resolve(import.meta.dirname, '.tmp-context-test');

function makeFileDiff(overrides: Partial<FileDiff> & { path: string }): FileDiff {
  return {
    diff: '',
    additions: 1,
    deletions: 0,
    isNew: false,
    isDeleted: false,
    isBinary: false,
    ...overrides,
  };
}

describe('loadFileContext', () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('returns file content for existing file', () => {
    const filePath = 'test.ts';
    writeFileSync(resolve(TMP_DIR, filePath), 'const x = 1;\nconst y = 2;\n');

    const diff = makeFileDiff({ path: filePath });
    const context = loadFileContext(diff, 500, TMP_DIR);

    expect(context).toContain('const x = 1;');
    expect(context).toContain('const y = 2;');
  });

  it('returns null for deleted files', () => {
    const diff = makeFileDiff({ path: 'deleted.ts', isDeleted: true });
    const context = loadFileContext(diff, 500, TMP_DIR);
    expect(context).toBeNull();
  });

  it('returns null for binary files', () => {
    const diff = makeFileDiff({ path: 'image.png', isBinary: true });
    const context = loadFileContext(diff, 500, TMP_DIR);
    expect(context).toBeNull();
  });

  it('returns null for non-existent files', () => {
    const diff = makeFileDiff({ path: 'nope.ts' });
    const context = loadFileContext(diff, 500, TMP_DIR);
    expect(context).toBeNull();
  });

  it('returns full content when under maxLines', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
    writeFileSync(resolve(TMP_DIR, 'small.ts'), lines);

    const diff = makeFileDiff({ path: 'small.ts' });
    const context = loadFileContext(diff, 500, TMP_DIR);

    expect(context).toBe(lines);
  });

  it('truncates content when over maxLines', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n');
    writeFileSync(resolve(TMP_DIR, 'large.ts'), lines);

    const hunkDiff = `diff --git a/large.ts b/large.ts
--- a/large.ts
+++ b/large.ts
@@ -500,3 +500,4 @@
 line 500
-line 501
+line 501 modified
+line 501b new
 line 502`;

    const diff = makeFileDiff({ path: 'large.ts', diff: hunkDiff });
    const context = loadFileContext(diff, 50, TMP_DIR);

    expect(context).not.toBeNull();
    // Should contain context around the hunk but not the entire file
    const contextLines = context!.split('\n').length;
    expect(contextLines).toBeLessThanOrEqual(50);
  });

  it('handles nested directories', () => {
    mkdirSync(resolve(TMP_DIR, 'src/utils'), { recursive: true });
    writeFileSync(resolve(TMP_DIR, 'src/utils/helper.ts'), 'export const helper = true;\n');

    const diff = makeFileDiff({ path: 'src/utils/helper.ts' });
    const context = loadFileContext(diff, 500, TMP_DIR);

    expect(context).toContain('export const helper = true;');
  });
});
