import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { minimatch } from 'minimatch';
import type { FileContent, FileDiff } from '../types.js';

/** Options for scanning files */
export interface ScanOptions {
  readonly glob?: string;
  readonly cwd?: string;
}

/**
 * Scan tracked files from the git repository.
 * Returns FileContent[] with path, content, and binary detection.
 */
export function scanFiles(options: ScanOptions = {}): readonly FileContent[] {
  const cwd = options.cwd ?? process.cwd();

  // Get list of tracked files
  const output = execSync('git ls-files', { encoding: 'utf-8', cwd, maxBuffer: 10 * 1024 * 1024 });
  let files = output
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);

  // Apply glob filter if specified
  if (options.glob) {
    files = files.filter((f) => minimatch(f, options.glob!));
  }

  // Read each file and detect binary
  return files.map((path) => {
    try {
      const buffer = readFileSync(`${cwd}/${path}`);
      const isBinary = detectBinary(buffer);
      return {
        path,
        content: isBinary ? '' : buffer.toString('utf-8'),
        isBinary,
      };
    } catch {
      // File might be deleted or unreadable
      return { path, content: '', isBinary: false };
    }
  });
}

/**
 * Convert FileContent to FileDiff format for pipeline compatibility.
 * In --all mode, we treat the entire file as "added" (all lines are additions).
 */
export function fileContentToFileDiff(file: FileContent): FileDiff {
  if (file.isBinary) {
    return {
      path: file.path,
      diff: `Binary file ${file.path}`,
      additions: 0,
      deletions: 0,
      isNew: false,
      isDeleted: false,
      isBinary: true,
    };
  }

  const lines = file.content.split('\n');
  // Create a synthetic diff showing all lines as additions
  const diffLines = lines.map((line) => `+${line}`);
  const diff = [
    `diff --git a/${file.path} b/${file.path}`,
    '--- /dev/null',
    `+++ b/${file.path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...diffLines,
  ].join('\n');

  return {
    path: file.path,
    diff,
    additions: lines.length,
    deletions: 0,
    isNew: false, // Not "new" in git sense, just reviewing existing file
    isDeleted: false,
    isBinary: false,
  };
}

/**
 * Detect if a buffer contains binary content.
 * Uses null byte detection (common heuristic).
 */
function detectBinary(buffer: Buffer): boolean {
  // Check first 8KB for null bytes
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}
