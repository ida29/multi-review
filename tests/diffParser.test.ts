import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDiff } from '../src/parse/diffParser.js';

const multiFileDiff = readFileSync(
  resolve(import.meta.dirname, 'fixtures/multi-file.diff'),
  'utf-8',
);

describe('parseDiff', () => {
  it('parses all files from multi-file diff', () => {
    const files = parseDiff(multiFileDiff);
    expect(files).toHaveLength(5);
  });

  it('extracts file paths correctly', () => {
    const files = parseDiff(multiFileDiff);
    const paths = files.map((f) => f.path);
    expect(paths).toEqual([
      'src/auth.ts',
      'package-lock.json',
      'src/utils.ts',
      'src/legacy.ts',
      'dist/bundle.min.js',
    ]);
  });

  it('counts additions and deletions', () => {
    const files = parseDiff(multiFileDiff);
    const auth = files.find((f) => f.path === 'src/auth.ts')!;
    expect(auth.additions).toBe(4);
    expect(auth.deletions).toBe(2);
  });

  it('detects new files', () => {
    const files = parseDiff(multiFileDiff);
    const utils = files.find((f) => f.path === 'src/utils.ts')!;
    expect(utils.isNew).toBe(true);
    expect(utils.isDeleted).toBe(false);
    expect(utils.additions).toBe(8);
    expect(utils.deletions).toBe(0);
  });

  it('detects deleted files', () => {
    const files = parseDiff(multiFileDiff);
    const legacy = files.find((f) => f.path === 'src/legacy.ts')!;
    expect(legacy.isDeleted).toBe(true);
    expect(legacy.isNew).toBe(false);
    expect(legacy.deletions).toBe(5);
    expect(legacy.additions).toBe(0);
  });

  it('detects binary files', () => {
    const files = parseDiff(multiFileDiff);
    const binary = files.find((f) => f.path === 'dist/bundle.min.js')!;
    expect(binary.isBinary).toBe(true);
    expect(binary.additions).toBe(0);
    expect(binary.deletions).toBe(0);
  });

  it('preserves full diff per file', () => {
    const files = parseDiff(multiFileDiff);
    const auth = files.find((f) => f.path === 'src/auth.ts')!;
    expect(auth.diff).toContain('diff --git a/src/auth.ts b/src/auth.ts');
    expect(auth.diff).toContain('bcrypt.compare');
    // Should not contain other files
    expect(auth.diff).not.toContain('package-lock.json');
  });

  it('handles empty input', () => {
    expect(parseDiff('')).toEqual([]);
  });

  it('handles single-file diff', () => {
    const singleDiff = `diff --git a/foo.ts b/foo.ts
index 1234567..abcdefg 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;`;

    const files = parseDiff(singleDiff);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe('foo.ts');
    expect(files[0]!.additions).toBe(1);
    expect(files[0]!.deletions).toBe(1);
  });

  it('handles lockfile changes', () => {
    const files = parseDiff(multiFileDiff);
    const lockfile = files.find((f) => f.path === 'package-lock.json')!;
    expect(lockfile.additions).toBe(1);
    expect(lockfile.deletions).toBe(1);
    expect(lockfile.isNew).toBe(false);
    expect(lockfile.isDeleted).toBe(false);
  });
});
